# FROM node:16
# LABEL maintainer = "Mingyang Wang <miw092@eng.uced.edu>"

# # Install necessary dependencies and tools
# RUN apt-get update && \

#     apt-get install -y --no-install-recommends redis-server && \

#     rm -rf /var/lib/apt/lists/*

# # Create app directory
# RUN mkdir -p /root/app
# WORKDIR /root/app

# # Install app dependences
# COPY package.json /root/app
# RUN npm install

# # Bundle app source
# COPY server.js /root/app
# COPY start_service.sh /root/app
# COPY views /root/app/views

# # Bind to local port 80
# EXPOSE 80

# # Start the service
# CMD ["/bin/bash", "start_service.sh"]


FROM node:16
LABEL maintainer = "Mingyang Wang <miw092@eng.uced.edu>"

# Install necessary dependencies and tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    redis-server \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release && \
    rm -rf /var/lib/apt/lists/*

# Install Docker CLI
RUN curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
RUN echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
RUN apt-get update && apt-get install -y docker-ce-cli && rm -rf /var/lib/apt/lists/*

# Create app directory
RUN mkdir -p /root/app
WORKDIR /root/app

# Install app dependences
COPY package.json /root/app
RUN npm install

# Bundle app source
COPY server.js /root/app
COPY start_service.sh /root/app
COPY views /root/app/views

# Bind to local port 80
EXPOSE 80

# Start the service
CMD ["/bin/bash", "start_service.sh"]