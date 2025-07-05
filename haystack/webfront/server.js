const app = require('express')();
var request = require('request');
const responseTime = require('response-time');
const shuffle = require('shuffle-array');
const cassandra = require('cassandra-driver');
const TimeUuid = require('cassandra-driver').types.TimeUuid;
const { exec } = require('child_process');

var flag=0;

// const redis = require('redis');
// const redis_client = redis.createClient();

const db_client = new cassandra.Client({
  contactPoints: ['172.20.0.4'],
  keyspace: 'photo'
});
db_client.connect(function(err) {
  if (err) console.log('Error ' + err);
});


const multer  = require('multer');
const upload = multer({
  dest: 'uploads/',
  inMemory: true
});
const fs = require('fs');

const demo_pids = [
  TimeUuid.fromString('97b72fb0-a84a-11e6-bf37-6d2c86545d91'),
  TimeUuid.fromString('8c2a5690-a84a-11e6-bf37-6d2c86545d91'),
  TimeUuid.fromString('fe7c3ce0-a84a-11e6-bf37-6d2c86545d91'),
  TimeUuid.fromString('0d4f8e70-a84b-11e6-bf37-6d2c86545d91'),
  TimeUuid.fromString('0dd9a600-a84b-11e6-bf37-6d2c86545d91'),
];

const cacheMap = {

  '127.0.0.1:8080': '127.0.0.1:8080',

  '172.20.0.5:8080': '127.0.0.1:8080'

};
// Add this function to periodically check for stale photos
function checkStalePhotos() {
  const query = 'SELECT pid, last_accessed FROM photo';
  db_client.execute(query, [], { prepare: true })
    .then(result => {
      const currentTime = new Date();
      result.rows.forEach(row => {
        const timeDiff = currentTime - row.last_accessed;
        const daysInactive = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
        
        if (daysInactive > 30) { // Example threshold of 30 days
          console.log(`Photo ${row.pid} has been inactive for ${daysInactive} days`);
          // You can implement your logic here for stale photos
        }
      });
    })
    .catch(err => console.error('Error checking stale photos:', err));
}

// Run check every 24 hours
setInterval(checkStalePhotos, 24 * 60 * 60 * 1000);

function checkStorageStatus(containerName, storageIP) {
  const { exec } = require('child_process');
  exec(`docker inspect -f {{.State.Running}} ${containerName}`, (error, stdout, stderr) => {
    if (error || stdout.trim() !== 'true') {
      const storageEndpoint = `${storageIP}:8080`;
      
      // First get all pids from photo table
      const getAllPidsQuery = 'SELECT pid FROM photo';
      
      db_client.execute(getAllPidsQuery, [], { prepare: true })
        .then(result => {
          // Extract all pids from the result
          const allPids = result.rows.map(row => row.pid);
          
          if (allPids.length > 0) {
            const queries = [
              {
                query: 'UPDATE store SET mid = mid - ? WHERE lvid IN (0, 1)',
                params: [[storageEndpoint]]
              },
              {
                query: 'UPDATE photo SET mid = mid - ? WHERE pid IN ?',
                params: [[storageEndpoint], allPids]
              }
            ];

            return Promise.all(queries.map(q => 
              db_client.execute(q.query, q.params, { prepare: true })
            ));
          }
        })
        .then(() => {
          if(!flag) {
            console.log(`Removed ${storageEndpoint} from Cassandra tables`);
            flag = 1;
          }
        })
        .catch(err => console.error('Error updating Cassandra:', err));
    }
  });
}

setInterval(() => {

  checkStorageStatus('h_storage1', '172.20.0.6');

  checkStorageStatus('h_storage2', '172.20.0.7'); 

}, 5000)

app.set('port', (process.env.PORT || 80));

// set up the response-time middleware
app.use(responseTime());

app.set('view engine', 'pug');

class UrlBuilder {
  query(pid, resolve) {
    const query = 'SELECT * FROM photo WHERE pid = ?';
    db_client.execute(query, [pid], {prepare: true}, (err, result) => {
        if (err) console.log(err);

        const row = result.rows[0];
        const mid = UrlBuilder._arrayRandom(row.mid);
        const photo_path = this.build(row.pid, row.cache_url, mid, row.lvid);
        resolve({
            photo_path: photo_path,
            last_accessed: row.last_accessed
        });
    });
}

  static _arrayRandom(xs) {
    return xs[Math.floor(Math.random()*xs.length)];
  }

  randomQuery(num, resolve) {
    // randomly generate $num photoids to simulate a dynamic webpage
    // and generate corresponding query
    var indexes = shuffle(Array.apply(null, Array(demo_pids.length)).map(function(_, i) {
      return i;
    })).slice(0, num);

    var ids = [];
    for (var i = 0; i < indexes.length; i++)
      ids.push(demo_pids[indexes[i]]);

    var query = 'SELECT * FROM photo WHERE pid IN ( ? ';
    for (var i = 1; i < num; i++) {
      query += ', ? ';
    }
    query += ' )';

    db_client.execute(query, ids, {
      prepare: true
    }, (err, result) => {
      if (err) console.log('Error ' + err);

      let photo_paths = new Array(num);
      for (var i = 0; i < num; i++) {
        const row = result.rows[i];
        const mid = UrlBuilder._arrayRandom(row.mid);
        const photo_path = this.build(row.pid, row.cache_url, mid, row.lvid);
        photo_paths[i] = photo_path;
      }

      resolve(photo_paths);
    });
  }

  build(pid, cacheUrl, machineId, logicialVolId) {
    // sample: http://localhost:8080/machineIdBase64/logicialVolId/pid
    const machineIdBase64 = new Buffer(machineId).toString('base64');
    const cacheUrlPublic = cacheMap[cacheUrl];  // exposed port of cache to client
    const url = 'http://' + [cacheUrlPublic, machineIdBase64, logicialVolId, pid.toString()].join('/');
    return url;
  }
}

app.get('/', (req, res) => {
  var num = 3;
  const builder = new UrlBuilder();
  builder.randomQuery(num, (photo_paths) => {
    res.render('index', {
      title: 'Comic Gallery',
      photo_paths: photo_paths,
    });
  });
});

app.get('/upload/', (req, res) => {
  res.render('upload', { title: 'Upload Photo' });
});

app.post('/photo/', upload.single('image'), (req, res) => {
  // auto-assign a pid
  var pid = TimeUuid.now();

  // ask Directory for writable logical volumes
  var lvid_query = 'SELECT lvid, mid FROM store WHERE status = 1 LIMIT 5 ALLOW FILTERING';
  db_client.execute(lvid_query, [], { prepare: true }, (err, result) => {
    if (err) console.error('Error: ', err);

    let entry = UrlBuilder._arrayRandom(result.rows);
    let lvid = entry.lvid;

    // Column names that contain characters that CQL cannot parse need to be enclosed in double quotation marks in CQL.
    const insert_query = "INSERT INTO photo (pid, cache_url, mid, lvid, last_accessed) VALUES (?, '127.0.0.1:8080', ?, ?, ?);";
    db_client.execute(insert_query, [pid, entry.mid, lvid,new Date()], { prepare: true }, (err) => {
      if (err) {
        console.error('Error: ', err);
        res.status(400).end(err);
      } else {
        console.log('Uploading to store');
        // Write to store machines
        const formData = {
          'image': fs.createReadStream(req.file.path),
        };
        const promises = entry.mid.map((mid) => {
          return new Promise((resolve, reject) => {
            request.post({
              url: 'http://' + [mid, lvid, pid.toString(), req.file.mimetype.split('/')[1]].join('/'),
              formData: formData,
            }, (err, response, body) => {
              if (err) {
                reject(err);
              } else {
                const msg = 'Uploaded as pid: ' + pid.toString() + ' in ' + mid;
                resolve(msg);
              }
            });
          });
        });

        Promise.all(promises)
            .then((msgs) => {  // resolve iterable
              msgs.map((msg) => console.log(msg));
              res.end('Photo uploaded successfully, pid: ' + pid);
            })
            .catch((err) => {
              console.error('Uploaded fail: ', err);
              res.status(400).end(err)
            });
      }
    });
  });
});

app.delete('/photo/:photoid', (req, res) => {
  const pid = TimeUuid.fromString(req.params.photoid);
  redis_client.del(pid.toString());
  const query = 'SELECT pid, cache_url, mid, lvid FROM photo WHERE pid = ? ';
  db_client.execute(query, [pid], {prepare: true}, (err, result) => {
    if (err) console.log(err);

    const row = result.rows[0];
    if (!row) {
      res.send('No key found, pid: ' + pid.toString).end();
      return;
    }

    const update = 'DELETE FROM photo WHERE pid = ' + row.pid;
    const cass_promise = new Promise((resolve, reject) => {
      db_client.execute(update, {prepare: true}, (err, result) => {
        if (err) {
          console.error(err);
          reject(err);
        } else {
          resolve();
        }
      });
    });

    // Query cache to invalidate
    const redis_promise = new Promise((resolve, reject) => {
      request.delete({
        url: 'http://' + [row.cache_url, row.pid.toString()].join('/'),
      }, (err, response, body) => {
        if (err) {
          console.error(err);
          reject(err);
        } else {
          console.log('Cache: ' + body);
          resolve();
        }
      });
    });

    // Query store machine to delete
    const promises = [];
    for (let ip of row.mid) {
      const url = 'http://' + [ip, row.lvid, row.pid.toString()].join('/');
      promises.push(
        new Promise((resolve, reject) => {
          request.delete({
            url: url,
          }, (err, response, body) => {
            if (err) {
              console.error(err);
              reject(err);
            } else {
              console.log('Store: ' + body);
              resolve();
            }
          });
        })
      );
    }

    promises.push(cass_promise);
    promises.push(redis_promise);
    Promise.all(promises)
        .then(() => res.send('Photo on all caches and stores deleted'))
        .catch((err) => console.log(err));
  });
});


// app.get('/photo/:photoid', (req, res) => {
//   const pid = TimeUuid.fromString(req.params.photoid);
//   const builder = new UrlBuilder();

//   redis_client.get(pid.toString(), (err, result) => {
//     if (err) console.log(err);

//     if (result) {
//       console.log('Cache hit '+pid);
//       res.render('photo', {
//         title: 'photo: ' + req.params.photoid,
//         photo_path: result,
//       });
//     } else {
//       builder.query(pid, (photo_path) => {
//         redis_client.setex(pid.toString(), 120, photo_path);
//         console.log('Cache updated');

//         res.render('photo', {
//           title: req.params.name,
//           photo_path: photo_path,
//         });
//       });
//     }
//   });

// });
app.get('/photo/:photoid', (req, res) => {
  const pid = TimeUuid.fromString(req.params.photoid);
  const builder = new UrlBuilder();
  
  // First update last_accessed timestamp
  const updateQuery = 'UPDATE photo SET last_accessed = ? WHERE pid = ?';
  const currentTime = new Date();
  
  db_client.execute(updateQuery, [currentTime, pid], { prepare: true })
      .then(() => {
          // Then proceed with photo retrieval
          builder.query(pid, (result) => {
              res.render('photo', {
                  title: req.params.name,
                  photo_path: result.photo_path,
                  last_accessed: currentTime // Use current time since we just updated it
              });
          });
      })
      .catch(err => {
          console.error('Error updating last_accessed:', err);
          res.status(500).send('Error updating access time');
      });
});
// Add new endpoint to check last access time

app.get('/photo/:photoid/access-info', (req, res) => {
                                             
  const pid = TimeUuid.fromString(req.params.photoid);

  

  const query = 'SELECT last_accessed FROM photo WHERE pid = ?';

  db_client.execute(query, [pid], { prepare: true })

    .then(result => {

      const row = result.rows[0];

      if (!row) {

        res.status(404).json({ error: 'Photo not found' });

        return;

      }


      const lastAccessed = row.last_accessed;

      const currentTime = new Date();

      const timeDiff = currentTime - lastAccessed;

      

      res.json({

        pid: pid.toString(),

        last_accessed: lastAccessed,

        time_since_last_access: {

          milliseconds: timeDiff,

          seconds: Math.floor(timeDiff / 1000),

          minutes: Math.floor(timeDiff / (1000 * 60)),

          hours: Math.floor(timeDiff / (1000 * 60 * 60)),

          days: Math.floor(timeDiff / (1000 * 60 * 60 * 24))

        }

      });

    })

    .catch(err => {

      console.error('Error getting access info:', err);

      res.status(500).json({ error: 'Error retrieving access information' });

    });

});
app.listen(app.get('port'), function() {
  console.log('Server listening on port: ', app.get('port'));
});
