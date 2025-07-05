FROM node:16

LABEL maintainer="Kun Huang <kuh004@ucsd.edu>, Junbo Ke <juke@ucsd.edu>"

# Install Redis
RUN apt-get update && \
    apt-get install -y --no-install-recommends redis-server && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
RUN mkdir -p /root/app
WORKDIR /root/app

# Install app dependencies first
COPY package.json /root/app/
RUN npm install
RUN npm install filepointer --save

# Bundle app source
COPY server.js /root/app/
COPY start_service.sh /root/app/

# Create data directory
RUN mkdir -p /root/data
COPY volumes/ /root/data/

# Expose port
EXPOSE 8080

# Start service
CMD ["/bin/bash", "start_service.sh"]