module.exports = {
  async queryWithConn(conn, query, params = []) {
    return new Promise((resolve, reject) => {
      conn.query(query, params, function (err, rows, fields) {
        if (err) {
          console.log(conn._protocol._fatalError);
          console.log(query.substring(0, 1000));
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  },
  async queryWithConnOnce(conn, query, params = []) {
    return new Promise((resolve, reject) => {
      conn.query(query, params, function (err, rows, fields) {
        if (err) {
          console.log(conn._protocol._fatalError);
          console.log(query.substring(0, 1000));
          reject(err);
        } else {
          resolve(rows);
        }
        conn.release();
      });
    });
  }
};
