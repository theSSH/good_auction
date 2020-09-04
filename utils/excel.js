/* eslint-disable */
const { saveAs } = require('file-saver');
const XLSX = require('xlsx');
const {typeOf, child} = require('./index');
const { promisify } = require('util');

async function xlsx(datas, filename) {
  let sheets = [];
  for (let d of datas) {
    let {data, header, fields, sheetName} = d;
    data = data.map(e=>remapObj(e));

    // fields 가 없다면 모든 row 를 중첩시킨 뒤 추출한 전체 키를 field로 한다.
    if (!fields || !fields.length) {
      let dupObj = {};
      data.forEach(e=>Object.assign(dupObj,e));
      fields = Object.keys(dupObj);
    }
    // header 가 없다면 fields 로 대체
    if (!header) header = fields;

    // fields 에 해당하는 데이터만 남도록 재구성한다.
    data = data.map(obj=>{
      return fields.map(f=>obj[f]);
    });
    sheets.push({data, header, fields, sheetName, autoWidth:true});
  }

  return await child([`const XLSX = require('xlsx');`, Workbook.toString(), sheet_from_array_of_arrays.toString()], export_json_to_excel, [{
    filename,
    saveFile: true,
    bookType: 'xlsx',
    sheets
  }], false);
}

async function down(list, header, fields, filename = 'export', bookType = 'xlsx', saveFile = false, options = {}) {
  // options : types:{link:'link'}, sheetName:'Products'
  let data = list.map(e=>remapObj(e));

  // fields 가 없다면 모든 row 를 중첩시킨 뒤 추출한 전체 키를 field로 한다.
  if (!fields || !fields.length) {
    let dupObj = {};
    data.forEach(e=>Object.assign(dupObj,e));
    fields = Object.keys(dupObj);
  }
  // header 가 없다면 fields 로 대체
  if (!header) header = fields;

  // fields 에 해당하는 데이터만 남도록 재구성한다.
  data = data.map(obj=>{
    return fields.map(f=>obj[f]);
  });

  // return buffer of workbook
  // return XLSX.write(export_json_to_excel({
  //   header,
  //   fields,
  //   data,
  //   filename,
  //   autoWidth: true,
  //   bookType,
  //   ...options
  // }), {
  //   type: 'base64'
  // });

  await child([`const XLSX = require('xlsx');`, Workbook.toString(), sheet_from_array_of_arrays.toString()], export_json_to_excel, [{
    filename,
    saveFile: true,
    bookType,
    sheets: [
      {
        header,
        fields,
        data,
        autoWidth: true,
        ...options
      }
    ]
  }], false);

  // return export_json_to_excel({
  //   filename,
  //   bookType,
  //   sheets: [
  //     {
  //       header,
  //       fields,
  //       data,
  //       autoWidth: true,
  //       ...options
  //     }
  //   ]
  // });
}

/**
 * csv export part
 */
function convertToCSV(array) {
  /**
   * 모든 키를 확인하기 위해 모든 데이터를 중첩시킨 뒤 키를 확보한다.
   * 해당 키를 바탕으로 csv 형태를 만든다.
   */
  let str = '';
  let arr = array.map(e=>remapObj(e));
  let dupObj = {};
  arr.forEach(e=>Object.assign(dupObj,e));
  let keys = Object.keys(dupObj);
  str = keys.map(e=>`"${e.replace(/"/g,'""')}"`).join(',') + '\r\n';
  arr.forEach(row=>{
    str += keys.map(k=>{
      return row[k] != null ? `"${(row[k]+'').replace(/"/g,'""')}"` : '';
    }).join(',') + '\r\n';
  });
  return str;
}
function remapObj(obj, prefix = '') {
  /**
   * a:{b:1}, c:[2,3] 등의 중첩된 형태를 엑셀형태로 바꾸기 위해 a.b, c.0 으로 바꾸어 매핑한다
   */
  let reMap = {};
  if (typeOf(obj) === 'object') {
    Object.entries(obj).forEach(([k,v])=>{
      Object.assign(reMap, remapObj(v, (prefix ? prefix + '.' : '') + k));
    });
  } else if (typeOf(obj) === 'array') {
    obj.forEach((e,i)=>{
      Object.assign(reMap, remapObj(e, (prefix ? prefix + '.' : '') + i));
    });
  } else {
    reMap[prefix] = obj;
  }
  return reMap;
}

function generateArray(table) {
  let out = [];
  let rows = table.querySelectorAll('tr');
  let ranges = [];
  for (let R = 0; R < rows.length; ++R) {
    let outRow = [];
    let row = rows[R];
    let columns = row.querySelectorAll('td');
    for (let C = 0; C < columns.length; ++C) {
      let cell = columns[C];
      let colspan = cell.getAttribute('colspan');
      let rowspan = cell.getAttribute('rowspan');
      let cellValue = cell.innerText;
      if (cellValue !== "" && cellValue == +cellValue) cellValue = +cellValue;

      //Skip ranges
      ranges.forEach(function (range) {
        if (R >= range.s.r && R <= range.e.r && outRow.length >= range.s.c && outRow.length <= range.e.c) {
          for (let i = 0; i <= range.e.c - range.s.c; ++i) outRow.push(null);
        }
      });

      //Handle Row Span
      if (rowspan || colspan) {
        rowspan = rowspan || 1;
        colspan = colspan || 1;
        ranges.push({
          s: {
            r: R,
            c: outRow.length
          },
          e: {
            r: R + rowspan - 1,
            c: outRow.length + colspan - 1
          }
        });
      };

      //Handle Value
      outRow.push(cellValue !== "" ? cellValue : null);

      //Handle Colspan
      if (colspan)
        for (let k = 0; k < colspan - 1; ++k) outRow.push(null);
    }
    out.push(outRow);
  }
  return [out, ranges];
}

function datenum(v, date1904) {
  if (date1904) v += 1462;
  let epoch = Date.parse(v);
  return (epoch - new Date(Date.UTC(1899, 11, 30))) / (24 * 60 * 60 * 1000);
}

function sheet_from_array_of_arrays(data, opts = {}) {
  let ws = {};
  let range = {
    s: {
      c: 10000000,
      r: 10000000
    },
    e: {
      c: 0,
      r: 0
    }
  };
  const typeMap = {
    number: 'n',
    string: 's',
    boolean: 'b',
    date: 'd',
    link: 'l',
    image: 'i',
  };
  for (let R = 0; R != data.length; ++R) {
    for (let C = 0; C != data[R].length; ++C) {
      if (range.s.r > R) range.s.r = R;
      if (range.s.c > C) range.s.c = C;
      if (range.e.r < R) range.e.r = R;
      if (range.e.c < C) range.e.c = C;
      let cell = {
        v: data[R][C]
      };
      if (cell.v == null) continue;
      let cell_ref = XLSX.utils.encode_cell({
        c: C,
        r: R
      });

      if (opts.types && opts.fields && opts.types[opts.fields[C]]) {
        let t = typeMap[opts.types[opts.fields[C]]];
        if (t === 'l' && cell.v.startsWith('http')) {
          cell.f = `=HYPERLINK("${cell.v}", "Link")`;
        } else if (t === 'i' && cell.v.startsWith('http')) {
          // delete cell.v;
          // cell.h = `<b>1</b><img src="${cell.v}"/>`;
          cell.t = 's';
        } else {
          cell.t = t;
          if (t === 'd') {
            cell.t = 'n';
            cell.z = XLSX.SSF._table[14];
            cell.v = datenum(cell.v);
          }
        }
      } else {
        if (typeof cell.v === 'number') cell.t = 'n';
        else if (typeof cell.v === 'boolean') cell.t = 'b';
        else if (cell.v instanceof Date) {
          cell.t = 'n';
          cell.z = XLSX.SSF._table[14];
          cell.v = datenum(cell.v);
        } else cell.t = 's';
      }

      ws[cell_ref] = cell;
    }
  }
  if (range.s.c < 10000000) ws['!ref'] = XLSX.utils.encode_range(range);
  return ws;
}

function Workbook() {
  if (!(this instanceof Workbook)) return new Workbook();
  this.SheetNames = [];
  this.Sheets = {};
}

function s2ab(s) {
  let buf = new ArrayBuffer(s.length);
  let view = new Uint8Array(buf);
  for (let i = 0; i != s.length; ++i) view[i] = s.charCodeAt(i) & 0xFF;
  return buf;
}

function export_table_to_excel(id) {
  let theTable = document.getElementById(id);
  let oo = generateArray(theTable);
  let ranges = oo[1];

  /* original data */
  let data = oo[0];
  let ws_name = "SheetJS";

  let wb = new Workbook(),
    ws = sheet_from_array_of_arrays(data);

  /* add ranges to worksheet */
  // ws['!cols'] = ['apple', 'banan'];
  ws['!merges'] = ranges;

  /* add worksheet to workbook */
  wb.SheetNames.push(ws_name);
  wb.Sheets[ws_name] = ws;

  let wbout = XLSX.write(wb, {
    bookType: 'xlsx',
    bookSST: false,
    type: 'binary'
  });

  saveAs(new Blob([s2ab(wbout)], {
    type: "application/octet-stream"
  }), "test.xlsx")
}

function export_json_to_excel({
      multiHeader = [],
      header,
      fields,
      types = {},
      data,
      filename,
      saveFile = false,
      sheetName,
      merges = [],
      autoWidth = true,
      bookType = 'xlsx',
      sheets = []
    } = {}) {

  let wb = new Workbook();

  if (bookType === 'xlsx' && sheets.length) {
    for (let sh of sheets) {
      let ws = makeSheet(sh);

      /* add worksheet to workbook */
      let ws_name = sh.sheetName || "SheetJS";
      wb.SheetNames.push(ws_name);
      wb.Sheets[ws_name] = ws;
    }
  } else {
    let ws = sheets ? makeSheet(sheets[0]) : makeSheet({
      multiHeader,
      header,
      fields,
      types,
      data,
      merges,
      autoWidth});

    /* add worksheet to workbook */
    let ws_name = sheetName || "SheetJS";
    wb.SheetNames.push(ws_name);
    wb.Sheets[ws_name] = ws;
  }

  function makeSheet({
     multiHeader = [],
     header,
     fields,
     types = {},
     data,
     merges = [],
     autoWidth = true,
    }) {
    data = [...data];
    data.unshift(header);

    for (let i = multiHeader.length - 1; i > -1; i--) {
      data.unshift(multiHeader[i])
    }

    let ws = sheet_from_array_of_arrays(data, {fields, types});

    if (merges.length > 0) {
      if (!ws['!merges']) ws['!merges'] = [];
      merges.forEach(item => {
        ws['!merges'].push(XLSX.utils.decode_range(item))
      })
    }

    if (autoWidth) {
      /* 워크 시트의 각 열의 최대 너비를 설정하십시오. */
      const colWidth = data.map(row => row.map((val, idx) => {
        /* 먼저 null / undefined 인지 확인하십시오 */
        let wch = 5;
        if (val == null || types[fields[idx]] === 'link') {
          wch = 10;
        } else if (val.toString().charCodeAt(0) > 255) { /* 2byte 문자인지 판단 */
          wch = val.toString().length * 2;
        } else {
          wch = val.toString().length;
        }
        wch = Math.min(wch, 50);
        return {wch};
      }));
      /* 첫 줄 초기 값을 가져 가라 */
      let result = colWidth[0];
      for (let i = 1; i < colWidth.length; i++) {
        for (let j = 0; j < colWidth[i].length; j++) {
          if (result[j]['wch'] < colWidth[i][j]['wch']) {
            result[j]['wch'] = colWidth[i][j]['wch'];
          }
        }
      }
      ws['!cols'] = result;
    }

    return ws;
  }

  if (saveFile) {
    XLSX.writeFile(wb, `${filename}.${bookType}`);
    return;
  }

  let wbout = XLSX.write(wb, {
    bookType: bookType,
    bookSST: false,
    type: 'base64'
  });
  // let wbout = XLSX.write(wb, {
  //   bookType: bookType,
  //   bookSST: false,
  //   type: 'binary'
  // });

  return wbout;
  // saveAs(new Blob([s2ab(wbout)], {
  //   type: "application/octet-stream"
  // }), `${filename}.${bookType}`);
}

module.exports = {
  xlsx,
  down,
  remapObj,
  export_table_to_excel,
  export_json_to_excel,
};
