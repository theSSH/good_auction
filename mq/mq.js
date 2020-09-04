const amqplib = require('amqplib');

const MQ = amqplib.connect('amqp://' + process.env.MQ_URL);
const IMAGE_PROCESSING = 'proxy-worker-image-crop-resize';

module.exports = {MQ, IMAGE_PROCESSING};
