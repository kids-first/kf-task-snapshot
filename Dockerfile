FROM        node:8.11.3-alpine

WORKDIR     /app

COPY        package*.json /app/
RUN         npm install 
COPY        . /app 

ENV         PORT 80
EXPOSE      80
CMD         ["npm", "start"]
