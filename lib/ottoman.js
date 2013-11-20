/*
 Add querying and design doc building.
 Need to set up handling for dealing with non-loaded
    objects so users can't try and use them.
 Add validation support.
 */

var uuid = require('node-uuid');
var _ = require('underscore');

var CORETYPES = ['string', 'integer', 'number', 'boolean'];
var INTERNALGIZMO = new Object();

// A map of all Ottoman types that have been registered.
var typeList = {};
var queries = [];

/**
 * Returns a ottoman type name by matching the input
 * object against the type descriminators.
 * @param {Object} obx
 * @returns {string}
 */
function typeNameFromObx(obx) {
  for (var i in typeList) {
    if (typeList.hasOwnProperty(i)) {
      var info = typeList[i].prototype.$;

      var matches = true;
      for (var j in info.descrims) {
        if (info.descrims.hasOwnProperty(j)) {
          if (obx[j] != info.descrims[j]) {
            matches = false;
            break;
          }
        }
      }
      if (matches) {
        return info.name;
      }
    }
  }

  return null;
}

/**
 * Determins if an obx object is a ottoman type.
 * @param {Object} obx
 * @returns {boolean}
 */
function isOttoObx(obx) {
  if (obx instanceof Object && typeNameFromObx(obx)) {
    return true;
  }
  return false;
}

/**
 * Determines if an obx object is a reference to another document.
 * @param {Object} obx
 * @returns {boolean}
 */
function isRefObx(obx) {
  if (obx instanceof Object && obx['$ref']) {
    return true;
  }
}

/**
 * Scans through the ottoman type list to identify if this object
 * is an instance of a ottoman type.
 * @param {Object} obj
 * @returns {boolean}
 */
function isOttoObj(obj) {
  for (var i in typeList) {
    if (typeList.hasOwnProperty(i)) {
      if (obj instanceof typeList[i]) {
        return true;
      }
    }
  }
  return false;
}



function obxToObj_Otto_Load(obj, obx, depth, objCache) {
  var info = obj.$;

  if (!(obx instanceof Object)) {
    throw new Error('expected value of type Object');
  }

  // Lets check for sanity sake
  var obxTypeName = typeNameFromObx(obx);
  if (obxTypeName !== obj.$.name) {
    throw new Error('data is wrong type');
  }

  obj.$values = {};
  obj.$loaded = true;
  obj.$initial = obx;

  for (var i in info.schema) {
    if (info.schema.hasOwnProperty(i)) {
      var field = info.schema[i];

      var subtypes = [];
      if (field.subtype) {
        subtypes.push(field.subtype);
      }

      var newObj = obxToObj(obx[field.name], field.type, subtypes, depth+1, objCache, null);
      if (newObj !== undefined) {
        obj.$values[field.name] = newObj;
      }
    }
  }
}

function obxToObj_Otto(obx, typeName, subtypeNames, depth, objCache, thisKey) {
  var type = typeList[typeName];

  if (isRefObx(obx)) {
    var refkey = obx['$ref'][1];

    // Referenced
    if (!(obx instanceof Object)) {
      throw new Error('expected object to be an Object')
    }
    if (obx['$ref'].length !== 2) {
      throw new Error('expected reference object');
    }
    if (obx['$ref'][0] !== typeName) {
      throw new Error('data is wrong type');
    }

    // Check the cache
    var cachedObj = objCache[refkey];
    if (cachedObj) {
      if (cachedObj.$.name !== obx['$ref'][0]) {
        throw new Error('object cached but later found as different type');
      }
      return cachedObj;
    }

    // Create the object
    var obj = new type(INTERNALGIZMO);

    obj.$key = refkey;
    obj.$cas = null;
    obj.$cache = objCache;

    obj.$values = null;
    obj.$loaded = false;
    obj.$initial = null;

    // Add to object cache
    objCache[refkey] = obj;

    return obj;
  } else {
    // Embedded
    if (thisKey === undefined) {
      throw new Error('internal: thisKey should be null or a string');
    }

    var obj = new type(INTERNALGIZMO);
    obj.$key = thisKey;
    obj.$cas = null;
    obj.$cache = objCache;

    // Add to object cache
    if (thisKey) {
      objCache[thisKey] = obj;
    }

    // Populate data
    obxToObj_Otto_Load(obj, obx, depth+1, objCache);
    return obj;
  }
}

function obxToObj_List(obx, typeName, subtypeNames, depth, objCache, thisKey) {
  if (!Array.isArray(obx)) {
    throw new Error('expected array');
  }

  if (!subtypeNames || subtypeNames.length == 0) {
    subtypeNames = ['Mixed'];
  }

  var out = [];
  for (var i = 0; i < obx.length; ++i) {
    var newObj = obxToObj(obx[i], subtypeNames[0], subtypeNames.slice(1), depth+1, objCache, null);
    if (newObj !== undefined) {
      out[i] = newObj;
    }
  }
  return out;
}

function obxToObj_Map(obx, typeName, subtypeNames, depth, objCache, thisKey) {
  if (!(obx instanceof Object)) {
    throw new Error('expected object');
  }

  if (!subtypeNames || subtypeNames.length == 0) {
    subtypeNames = ['Mixed'];
  }

  var out = {};
  for (var i in obx) {
    if (obx.hasOwnProperty(i)) {
      var newObj = obxToObj(obx[i], subtypeNames[0], subtypeNames.slice(1), depth+1, objCache, null);
      if (newObj !== undefined) {
        out[i] = newObj;
      }
    }
  }
  return out;
}

function obxToObj_Mixed(obx, typeName, subtypeNames, depth, objCache, thisKey) {
  if (isRefObx(obx)) {
    return obxToObj_Otto(obx, obx['$ref'][0], null, depth, objCache, thisKey);
  } else if (isOttoObx(obx)) {
    var realTypeName = typeNameFromObx(obx);
    return obxToObj_Otto(obx, realTypeName, null, depth, objCache, thisKey);
  } else if (Array.isArray(obx)) {
    return obxToObj_List(obx, 'List', null, depth, objCache, thisKey);
  } else if (obx instanceof Object) {
    return obxToObj_Map(obx, 'Map', null, depth, objCache, thisKey);
  } else {
    return obx;
  }
}

function obxToObj(obx, typeName, subtypeNames, depth, objCache, thisKey) {
  if (!typeName) {
    typeName = 'Mixed';
  }

  if (obx === undefined) {
    return undefined;
  } else if (obx === null) {
    return null;
  }

  if (typeList[typeName]) {
    return obxToObj_Otto(obx, typeName, subtypeNames, depth, objCache, thisKey);
  } else if (typeName === 'List') {
    return obxToObj_List(obx, typeName, subtypeNames, depth, objCache, thisKey);
  } else if (typeName === 'Map') {
    return obxToObj_Map(obx, typeName, subtypeNames, depth, objCache, thisKey);
  } else if (typeName === 'Mixed') {
    return obxToObj_Mixed(obx, typeName, subtypeNames, depth, objCache, thisKey);
  } else if (CORETYPES.indexOf(typeName) >= 0) {
    if (obx instanceof Object) {
      throw new Error('core type is an object');
    }
    return obx;
  } else {
    throw new Error('encountered unknown type ' + typeName);
  }
}






function objToObx_Otto(obj, typeName, subtypeNames, depth, objRefs) {
  if (!(obj instanceof typeList[typeName])) {
    throw new Error('expected object of type ' + typeName);
  }

  if (depth > 0 && !obj.$.embed) {
    // Add to refs array, but only if its not already there.
    if (objRefs.indexOf(obj) < 0) {
      objRefs.push(obj);
    }

    return {'$ref': [obj.$.name, modelKey.call(obj)]};
  } else {
    // Some shortcuts
    var info = obj.$;
    var schema = info.schema;
    var values = obj.$values;

    var out = {};

    // Add schema fields
    for (var i in schema) {
      if (schema.hasOwnProperty(i)) {
        var field = schema[i];
        var subtypes = [];
        if (field.subtype) {
          subtypes.push(field.subtype);
        }

        var outObj = objToObx(values[field.name], field.type, subtypes, depth+1, objRefs);
        if (outObj !== undefined) {
          out[field.name] = outObj;
        }
      }
    }

    // Add descriminators
    for (var i in info.descrims) {
      if (info.descrims.hasOwnProperty(i)) {
        out[i] = info.descrims[i];
      }
    }

    return out;
  }
}

function objToObx_List(obj, typeName, subtypeNames, depth, objRefs) {
  if (!subtypeNames || subtypeNames.length == 0) {
    subtypeNames = ['Mixed'];
  }

  var out = [];
  for (var i = 0; i < obj.length; ++i) {
    var outObj = objToObx(obj[i], subtypeNames[0], subtypeNames.slice(1), depth+1, objRefs);
    if (outObj !== undefined) {
      out[i] = outObj;
    }
  }
  return out;
}

function objToObx_Map(obj, typeName, subtypeNames, depth, objRefs) {
  if (!subtypeNames || subtypeNames.length == 0) {
    subtypeNames = ['Mixed'];
  }

  var out = {};
  for (var i in obj) {
    if (obj.hasOwnProperty(i)) {
      var outObj = objToObx(obj[i], subtypeNames[0], subtypeNames.slice(1), depth+1, objRefs);
      if (outObj !== undefined) {
        out[i] = outObj;
      }
    }
  }
  return out;
}

function objToObx_Mixed(obj, typeName, subtypeNames, depth, objRefs) {
  if (isOttoObj(obj)) {
    return objToObx_Otto(obj, obj.$.name, null, depth, objRefs);
  } else if (Array.isArray(obj)) {
    return objToObx_List(obj, 'List', null, depth, objRefs);
  } else if (obj instanceof Object) {
    return objToObx_Map(obj, 'Map', null, depth, objRefs);
  } else {
    return obj;
  }
}

function objToObx(obj, typeName, subtypeNames, depth, objRefs) {
  if (!typeName) {
    typeName = 'Mixed';
  }

  if (obj === undefined) {
    return undefined;
  } else if (obj === null) {
    return null;
  }

  if (typeList[typeName]) {
    return objToObx_Otto(obj, typeName, subtypeNames, depth, objRefs);
  } else if (typeName === 'List') {
    return objToObx_List(obj, typeName, subtypeNames, depth, objRefs);
  } else if (typeName === 'Map') {
    return objToObx_Map(obj, typeName, subtypeNames, depth, objRefs);
  } else if (typeName === 'Mixed') {
    return objToObx_Mixed(obj, typeName, subtypeNames, depth, objRefs);
  } else if (CORETYPES.indexOf(typeName) >= 0) {
    if (obj instanceof Object) {
      throw new Error('core type is an object');
    }
    return obj;
  } else {
    throw new Error('encountered unknown type ' + typeName);
  }
}

function serialize(obj) {
  return objToObx(obj, obj.$.name, null, 0, []);
}
module.exports.serialize = serialize;









function save(obj, callback) {
  var objs = [obj];

  var saved = 0;
  function __doneOne() {
    saved++;
    if (saved === objs.length) {
      if (callback) {
        callback(null);
      }
    }
  }

  for (var i = 0; i < objs.length; ++i) {
    if (!objs[i].$loaded) {
      saved++;
      continue;
    }

    var key = modelKey.call(objs[i]);
    var doc = objToObx(objs[i], objs[i].$.name, null, 0, objs);

    if (_.isEqual(objs[i].$initial, doc)) {
      __doneOne();
    } else {
      objs[i].$initial = doc;
      obj.$.bucket.set(key, doc, {cas: obj.$cas}, function(){
        __doneOne();
      });
    }
  }
}
module.exports.save = save;


function _loadRefs(obj, depthLeft, callback) {
  var refs = [];
  objToObx(obj, obj.$.name, null, 0, refs);

  if (refs.length === 0) {
    callback(null);
    return;
  }

  var loaded = 0;
  for (var i = 0; i < refs.length; ++i) {
    _load(refs[i], depthLeft-1, function(err) {
      loaded++;
      if (loaded >= refs.length) {
        callback(null);
      }
    })
  }
}
function _load(obj, depthLeft, callback) {
  if (depthLeft === 0) {
    callback(null);
    return;
  }

  if (isOttoObj(obj)) {
    if (obj.$loaded) {
      _loadRefs(obj, depthLeft, callback);
    } else {
      var key = modelKey.call(obj);
      obj.$.bucket.get(key, {}, function(err, result) {
        obxToObj_Otto_Load(obj, result.value, 0, obj.$cache, key);
        obj.$cas = result.cas;
        _loadRefs(obj, depthLeft, callback);
      });
    }
  } else if (Array.isArray(obj)) {
    var loaded = 0;
    for (var i = 0; i < obj.length; ++i) {
      _load(obj[i], depthLeft, function(err) {
        loaded++;
        if (loaded === obj.length) {
          // TODO: Only returns last error
          callback(err);
        }
      });
    }
  } else if (obj instanceof Object) {
    var needsLoad = 0;
    for (var i in obj) {
      if (obj.hasOwnProperty(i)) {
        needsLoad++;
        _load(obj[i], depthLeft, function(err) {
          needsLoad--;
          if (needsLoad === 0) {
            // TODO: Only returns last error
            callback(err);
          }
        })
      }
    }
  } else {
    console.warn('attempted to call Load on a core type.');
  }
}
function load(obj, options, callback) {
  if (arguments.length === 2) {
    callback = options;
    options = {};
  }
  if (!options.depth || options.depth < 1) {
    options.depth = 1;
  }

  _load(obj, options.depth, callback);
}
module.exports.load = load;




function query(options, callback) {

}
module.exports.query = query;




function modelConstruct(maybeInternal) {
  hideInternals(this);

  this.$key = null;
  this.$values = {};
  this.$cas = null;
  this.$loaded = true;
  this.$initial = undefined;
  this.$cache = undefined;

  if (maybeInternal !== INTERNALGIZMO) {
    if (this.$.constructor) {
      this.$constructing = true;
      this.$.constructor.apply(this, arguments);
      delete this.$constructing;
    }
  }
}

function modelCheckRequired() {
  for (var i = 0; i < this.$.required.length; ++i) {
    if (!this[this.$.required[i]]) {
      throw new Error('required field missing: ' + this.$.required[i]);
    }
  }
}

function modelKey() {
  if (!this.$key) {
    modelCheckRequired.call(this);
    var key = this.$.name;
    for (var i = 0; i < this.$.id.length; ++i) {
      key += '_' + this[this.$.id[i]];
    }
    this.$key = key.toLowerCase();
  }
  return this.$key;
}

function findModelById() {
  var callback = arguments[arguments.length-1];

  var info = this.prototype.$;

  var key = info.name;
  for (var i = 0; i < info.id.length; ++i) {
    key += '_' + arguments[i];
  }
  key = key.toLowerCase();

  info.bucket.get(key, {}, function(err, result) {
    if (err) {
      return callback(err);
    }

    var obj = obxToObj(result.value, info.name, null, 0, {}, key);
    if (obj.$.name != info.name) {
      throw new Error(obj.$.name + ' is not a ' +  info.name);
    }

    callback(null, obj);
  });
}









function registerField(con, field, options) {
  var info = con.prototype.$;

  if (options.required) {
    info.required.push(field);
  }

  var getter = null;
  if (!options.auto) {
    getter = function() {
      return this.$values[options.name];
    };
  } else if(options.auto === 'uuid') {
    getter = function() {
      if (!this.$values[options.name]) {
        this.$values[options.name] = uuid.v4();
      }
      return this.$values[options.name];
    }
  }

  var setter = function(val) {
    if (!options.readonly || this.$constructing) {
      this.$values[options.name] = val;
    } else {
      throw new Error('attempted to set read-only property ' + field);
    }
  };

  Object.defineProperty(con.prototype, field, {
    get: getter,
    set: setter,
    enumerable: true
  });
}

/*
 target: 'BlogPost',
 mappedBy: 'creator',
 sort: 'desc',
 limit: 5
 */
function registerQuery(con, name, options) {
  var info = con.prototype.$;

  var query = {};
  query.name = name;
  query.target = options.target;
  query.mappedBy = options.mappedBy;
  query.sort = options.sort ? options.sort : 'desc';
  query.limit = options.limit ? options.limit : 0;

  info.queries[name] = query;
  queries.push(query);

  con.prototype[name] = function(options, callback) {
    if (!callback) {
      callback = options;
      options = {};
    }



    callback(null, 1);
  }
}

function buildDesignDocs() {
  var indexes = [];

  for (var i = 0; i < queries.length; ++i) {
    indexes.push([
      queries[i].target,
      queries[i].mappedBy
    ]);
  }

  console.log(indexes);
}
module.exports.buildDesignDocs = buildDesignDocs;

function normalizeSchema(schema) {
  for (var i in schema) {
    if (schema.hasOwnProperty(i)) {
      if (typeof(schema[i]) === 'string') {
        schema[i] = {
          type: schema[i]
        };
      } else if (typeof(schema[i]) !== 'object') {
        throw new Error('expected schema fields to be strings or objects');
      }

      if (!schema[i].name) {
        schema[i].name = i;
      }

      if (schema[i].auto) {
        // force auto fields to readonly
        schema[i].readonly = true;

        if (schema[i].auto === 'uuid') {
          if (schema[i].type && schema[i].type !== 'string') {
            throw new Error('uuid fields must be string typed');
          }
          schema[i].type = 'string';
        } else {
          throw new Error('unknown auto mode');
        }
      }
    }
  }
}

function validateSchemaIds(ids, schema) {
  for (var i = 0; i < ids.length; ++i) {
    var field = schema[ids[i]];

    if (!field) {
      throw new Error('id specified that is not in the schema');
    }
    if (!field.readonly) {
      throw new Error('id fields must be readonly');
    }

    // Force required on for id fields
    schema[ids[i]].required = true;
  }
}

function registerType(name, type) {
  if (typeList[name]) {
    throw new Error('Type with the name ' + name + ' was already registered');
  }
  typeList[name] = type;
}

function hideInternals(con) {
  var internalFields = ["$key", "$values", "$cas", "$loaded", "$initial", "$cache"];

  for (var i = 0; i < internalFields.length; ++i) {
    Object.defineProperty(con, internalFields[i], {
      enumerable: false,
      writable: true
    });
  }
}

function createModel(name, schema, options) {

  // Create a base function for the model.  This is done so that the
  //   stack traces will have a nice name for developers to identify.

  var con = null;
  eval('con = function ' + name + '() { modelConstruct.apply(this, arguments); }');
  if (false) { modelConstruct(); }

  // info object holds all the model-specific data.
  var info = {};
  con.prototype.$ = info;
  Object.defineProperty(con.prototype, "$", {
    enumerable: false,
    writable: true
  });

  // Store some stuff for later!
  info.model = con;
  info.name = name;
  info.schema = schema;
  info.constructor = options.constructor;
  info.bucket = options.bucket;
  info.embed = options.embed;
  info.required = [];
  info.queries = {};

  // Build the id list
  // This must happen before schema normalization
  if (options.id) {
    if (!Array.isArray(options.id)) {
      info.id = [options.id];
    } else {
      info.id = options.id;
    }
  } else {
    if (!schema['_id']) {
      schema['_id'] = {auto: 'uuid'};
    }
    info.id = ['_id'];
  }

  if (options.descriminators) {
    if (!(options.descriminators instanceof Object)) {
      throw new Error('descriminators must be an object');
    }
    info.descrims = options.descriminators;
  } else {
    info.descrims = {_type: name};
  }

  // Normalize Schema
  normalizeSchema(schema);
  validateSchemaIds(info.id, schema);

  for (var i in schema) {
    if (schema.hasOwnProperty(i)) {
      registerField(con, i, schema[i]);
    }
  }

  var queries = options.queries;
  if (queries) {
    for (var i in queries) {
      if (queries.hasOwnProperty(i)) {
        registerQuery(con, i, queries[i]);
      }
    }
  }

  con.prototype.test = function() {
    console.log('test: ' + modelKey.call(this));
  }

  con.findById = findModelById;

  registerType(name, con);
  return con;
}
module.exports.model = createModel;

function createType(name, schema, options) {
  if (!options) {
    options = {};
  }
  options.embed = true;

  return createModel(name, schema, options);
}
module.exports.type = createType;