'use strict';

const express = require('express');


const router = express.Router();

router.get('/', (req, res) => {
    return res.status(200).json({ 
        message: {
            name: 'snapshot task',
            version: '1.0.0'
        }
    });
});

module.exports = router;