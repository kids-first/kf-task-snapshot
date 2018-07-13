FROM        node:8.11.3-alpine

WORKDIR     /app

COPY        package*.json /app/
RUN         npm install 
COPY        . /app 

EXPOSE      3030
CMD         ["npm", "start"]