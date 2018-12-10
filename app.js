const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bodyParser = require('body-parser');

const logErrors = require('./middlewares/errorHandler');
const indexRouter = require('./routes/index');
const tasksRouter = require('./routes/tasks');
const downloadRouter = require('./routes/download');

const app = express();

app.use(cors());
app.use(morgan('combined'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(logErrors);
app.use('/', indexRouter);
app.use('/status', indexRouter);
app.use('/tasks', tasksRouter);
app.use('/download', downloadRouter);

module.exports = app;
