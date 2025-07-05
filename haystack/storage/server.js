  // require the dependencies we installed
  const express = require('express');
  const app = express();
  const responseTime = require('response-time');
  const redis = require('redis');
  const fs = require('fs');
  const filePointer = require("filepointer");
  const multer  = require('multer');
  var storage = multer.memoryStorage();
  const upload = multer({ storage: storage }).single('image');
  // const cassandra = require('cassandra-driver');

  // create a new redis client and connect to our local redis instance
  var client = redis.createClient();


  // Set key value pair: [photoid, [offset, size, type, is_exist]]
  client.rpush(['97b72fb0-a84a-11e6-bf37-6d2c86545d91', '0', '82931', 'gif', true]);
  client.rpush(['8c2a5690-a84a-11e6-bf37-6d2c86545d91', '131040', '56689', 'gif', true]);
  client.rpush(['fe7c3ce0-a84a-11e6-bf37-6d2c86545d91', '187729', '48109', 'gif', true]);
  client.rpush(['0d4f8e70-a84b-11e6-bf37-6d2c86545d91', '235838', '72917', 'gif', true]);
  client.rpush(['0dd9a600-a84b-11e6-bf37-6d2c86545d91', '308755', '67447', 'gif', true]);


// const STORAGE_IP = process.env.STORAGE_IP;


// // Redis client setup

// var client = redis.createClient();


// // Cassandra client setup 

// const db_client = new cassandra.Client({

//   contactPoints: ['172.20.0.4'],

//   keyspace: 'photo'

// });


// // Query to find all photos associated with this storage

// const query = 'SELECT pid, lvid FROM photo WHERE mid CONTAINS ?';


// db_client.execute(query, [STORAGE_IP], { prepare: true })

//   .then(result => {

//     result.rows.forEach(row => {

//       try {

//         // Read the logical volume file

//         const logicalVolume = fs.readFileSync("/root/data/" + row.lvid);

        

//         // Get file stats to calculate size

//         const stats = fs.statSync("/root/data/" + row.lvid);

        

//         // Calculate offset based on existing file size

//         const offset = stats.size;

        

//         // Create file pointer for reading data

//         const fp = new filePointer(logicalVolume);

        

//         // Get size of current photo data

//         const size = stats.size - offset;

        

//         // Push metadata to Redis with format [photoid, offset, size, type, exists]

//         client.rpush([

//           row.pid.toString(), 

//           offset.toString(),

//           size.toString(),

//           'gif',

//           true

//         ]);


//         console.log(`Pushed photo ${row.pid} to Redis`);


//       } catch (err) {

//         console.error(`Error processing photo ${row.pid}:`, err);

//       }

//     });

//   })

//   .catch(err => {

//     console.error('Error querying Cassandra:', err);

//   });


  // set the server listening port
  app.set('port', (process.env.PORT || 8080));

  // set up the response-time middleware
  app.use(responseTime());

  app.get('/', function (req, res) {
    res.send('Hello World');
  });

  // READ request
  app.get('/:lvid/:photoid', function(req, res) {
    var lvid = req.params.lvid;
    var photoid = req.params.photoid;

    console.log('Received READ request:');
    console.log('logical volumn id: '+lvid);
    console.log('photo id: '+photoid);

    client.lrange(photoid, 0, -1, function(err, reply) {
      if (err){
        const msg = 'In-memory mapping fails';
        console.error(msg, err);
        res.status(400);
        res.send(msg);
      } else if (reply[3] == 'false') {
        const msg = 'Data deleted';
        console.error(msg, err);
        res.status(400);
        res.send(msg);
      } else {
        try {
          console.log(reply);
          var offset = parseInt(reply[0]);
          var size = parseInt(reply[1]);
          var type = reply[2];

          var logicalVolume = fs.readFileSync("/root/data/"+lvid);

          var fp = new filePointer(logicalVolume);
          var buffer = fp.copy_abs(offset, offset+size);

          res.setHeader('Content-Type', 'image/'+type);
          res.end(new Buffer(buffer, 'base64'));
        } catch (e) {
          const msg = "Offset lookup fails";
          console.error(msg, e);
          res.status(400);
          res.send(msg);
        }
      }
    });
  });

  // WRITE request
  app.post('/:lvid/:photoid/:type', function(req, res) {
    var lvid = req.params.lvid;
    var photoid = req.params.photoid;
    var type = req.params.type;

    console.log('Received WRITE request:');
    console.log('logical volumn id: '+lvid);
    console.log('photo id: '+photoid);
    console.log('photo type: '+type);

    upload(req,res,function(err) {
      if(err) {
          return res.end("Error uploading file.");
      }
        
      var image = req.file.buffer;
      var size = image.length;
      var offset = fs.statSync("/root/data/"+lvid)['size'];
      
      fs.appendFile("/root/data/"+lvid, image, function(err){
        if (err){
          // TODO: handle error
          console.log('something is wrong: '+err);
          res.send('something is wrong');
          process.exit(1);
        } else {
          client.rpush([photoid, offset, size, type, true]);
          res.send("OK");
        }
      });


    });

  });

  // DELETE request
  app.delete('/:lvid/:photoid', function(req, res) {
    var lvid = req.params.lvid;
    var photoid = req.params.photoid;

    console.log('Received DELETE request:');
    console.log('logical volumn id: '+lvid);
    console.log('photo id: '+photoid);

    client.lrange(photoid, 0, -1, function(err, reply) {
      if (err){
        const msg = 'In-memory mapping fails';
        console.error(msg, err);
        res.status(400);
        res.send(msg);
      } else if (reply[3] == 'false') {
        const msg = 'Already deleted';
        console.error(msg, err);
        res.status(400);
        res.send(msg);
      } else {
        // reset it as false
        client.del(photoid, function(err, _) {
          if (err) {
            const msg = 'Unknown error';
            console.error(msg, err);
            res.status(400);
            res.send(msg);
          } else {
            client.rpush([photoid, reply[0], reply[1], reply[2], false]);
            res.status(200);
            res.send('OK');
          }
        });
      }
    });
  });

  app.listen(app.get('port'), function() {
    console.log('Server listening on port: ', app.get('port'));
  });
