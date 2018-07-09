'use strict';

const express = require('express');
const bodyParser = require('body-parser');

const logErrors = require('./middlewares/errorHandler');
const statusRouter = require('./routes/status');
const tasksRouter = require('./routes/tasks');


const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(logErrors);
app.use('/status', statusRouter);
app.use('/tasks', tasksRouter);

module.exports = app;