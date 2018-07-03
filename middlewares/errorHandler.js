const logErrors = (err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send({ error: err.message });
    next( err );
}

module.exports = logErrors;