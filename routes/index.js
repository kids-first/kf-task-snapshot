const express = require('express');


const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({
    message: {
      name: 'snapshot task',
      version: '1.2.0',
    },
  });
});

module.exports = router;
