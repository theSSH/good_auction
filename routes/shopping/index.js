const express = require('express');
const router = express.Router();
const moment = require('moment-timezone');
const axios = require('axios-https-proxy-fix');
const utils = require('../../utils');
const {db, sdb, second, stat} = require('../../db/mongo');
const REDIS = require('../../db/redis');

const app = utils.router(router);

app.get('/price/list', async (req, res) => {
  let q = req.query.q || req.body.q;
  if (q) {
    let r = await axios.get(`https://search.shopping.naver.com/search/all?query=${encodeURIComponent(q)}`, {headers: {'Accept-Encoding': 'gzip, deflate'}});
  }
  res.json({ok:1});
});

module.exports = router;

