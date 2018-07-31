# Use an official Node.js runtime as a parent image
FROM        node:10.3.0-alpine

# Set the working directory to /app
WORKDIR     /app

# Copy the current directory content into /app
ADD         . /app

# Install any needed modules in package*.json
RUN         npm install 

# Make port 80 accessible to the outside
EXPOSE      80

# Define environmental variables
ENV         PORT 80

# Run the application when the container launches
CMD         ["npm", "start"]
