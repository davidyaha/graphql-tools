'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.attachConnectorsToContext = exports.addSchemaLevelResolveFunction = exports.buildSchemaFromTypeDefinitions = exports.assertResolveFunctionsPresent = exports.addCatchUndefinedToSchema = exports.addResolveFunctionsToSchema = exports.addErrorLoggingToSchema = exports.forEachField = exports.SchemaError = exports.makeExecutableSchema = exports.generateSchema = undefined;

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol ? "symbol" : typeof obj; }; // Generates a schema for graphql-js given a shorthand schema

// TODO: document each function clearly in the code: what arguments it accepts
// and what it outputs.

var _language = require('graphql/language');

var _lodash = require('lodash.uniq');

var _lodash2 = _interopRequireDefault(_lodash);

var _utilities = require('graphql/utilities');

var _type = require('graphql/type');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// @schemaDefinition: A GraphQL type schema in shorthand
// @resolvers: Definitions for resolvers to be merged with schema
function SchemaError(message) {
  Error.captureStackTrace(this, this.constructor);
  this.message = message;
}
SchemaError.prototype = new Error();

function generateSchema() {
  console.error('generateSchema is deprecated, use makeExecutableSchema instead');
  return _generateSchema.apply(undefined, arguments);
}

// type definitions can be a string or an array of strings.
function _generateSchema(typeDefinitions, resolveFunctions, logger) {
  var allowUndefinedInResolve = arguments.length <= 3 || arguments[3] === undefined ? true : arguments[3];
  var resolverValidationOptions = arguments.length <= 4 || arguments[4] === undefined ? {} : arguments[4];

  if ((typeof resolverValidationOptions === 'undefined' ? 'undefined' : _typeof(resolverValidationOptions)) !== 'object') {
    throw new SchemaError('Expected `resolverValidationOptions` to be an object');
  }
  if (!typeDefinitions) {
    throw new SchemaError('Must provide typeDefinitions');
  }
  if (!resolveFunctions) {
    throw new SchemaError('Must provide resolveFunctions');
  }

  // TODO: check that typeDefinitions is either string or array of strings

  var schema = buildSchemaFromTypeDefinitions(typeDefinitions);

  addResolveFunctionsToSchema(schema, resolveFunctions);

  assertResolveFunctionsPresent(schema, resolverValidationOptions);

  if (!allowUndefinedInResolve) {
    addCatchUndefinedToSchema(schema);
  }

  if (logger) {
    addErrorLoggingToSchema(schema, logger);
  }

  return schema;
}

function makeExecutableSchema(_ref) {
  var typeDefs = _ref.typeDefs;
  var resolvers = _ref.resolvers;
  var connectors = _ref.connectors;
  var logger = _ref.logger;
  var _ref$allowUndefinedIn = _ref.allowUndefinedInResolve;
  var allowUndefinedInResolve = _ref$allowUndefinedIn === undefined ? false : _ref$allowUndefinedIn;
  var _ref$resolverValidati = _ref.resolverValidationOptions;
  var resolverValidationOptions = _ref$resolverValidati === undefined ? {} : _ref$resolverValidati;

  var jsSchema = _generateSchema(typeDefs, resolvers, logger, allowUndefinedInResolve, resolverValidationOptions);
  if (typeof resolvers.__schema === 'function') {
    // TODO a bit of a hack now, better rewrite generateSchema to attach it there.
    // not doing that now, because I'd have to rewrite a lot of tests.
    addSchemaLevelResolveFunction(jsSchema, resolvers.__schema);
  }
  if (connectors) {
    // connectors are optional, at least for now. That means you can just import them in the resolve
    // function if you want.
    attachConnectorsToContext(jsSchema, connectors);
  }
  return jsSchema;
}

function concatenateTypeDefs(typeDefinitionsAry) {
  var functionsCalled = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

  var resolvedTypeDefinitions = [];
  typeDefinitionsAry.forEach(function (typeDef) {
    if (typeof typeDef === 'function') {
      if (!(typeDef in functionsCalled)) {
        // eslint-disable-next-line no-param-reassign
        functionsCalled[typeDef] = 1;
        resolvedTypeDefinitions = resolvedTypeDefinitions.concat(concatenateTypeDefs(typeDef(), functionsCalled));
      }
    } else {
      if (typeof typeDef === 'string') {
        resolvedTypeDefinitions.push(typeDef.trim());
      } else {
        var type = typeof typeDef === 'undefined' ? 'undefined' : _typeof(typeDef);
        throw new SchemaError('typeDef array must contain only strings and functions, got ' + type);
      }
    }
  });
  return (0, _lodash2.default)(resolvedTypeDefinitions.map(function (x) {
    return x.trim();
  })).join('\n');
}

function buildSchemaFromTypeDefinitions(typeDefinitions) {
  // TODO: accept only array here, otherwise interfaces get confusing.
  var myDefinitions = typeDefinitions;
  if (typeof myDefinitions !== 'string') {
    if (!Array.isArray(myDefinitions)) {
      // TODO improve error message and say what type was actually found
      throw new SchemaError('`typeDefinitions` must be a string or array');
    }
    myDefinitions = concatenateTypeDefs(myDefinitions);
  }

  var astDocument = (0, _language.parse)(myDefinitions);
  var schema = (0, _utilities.buildASTSchema)(astDocument);

  var extensionsAst = extractExtensionDefinitions(astDocument);
  if (extensionsAst.definitions.length > 0) {
    schema = (0, _utilities.extendSchema)(schema, extensionsAst);
  }

  return schema;
}

function extractExtensionDefinitions(ast) {
  var extensionDefs = ast.definitions.filter(function (def) {
    return def.kind === _language.Kind.TYPE_EXTENSION_DEFINITION;
  });

  return _extends({}, ast, {
    definitions: extensionDefs
  });
}

function forEachField(schema, fn) {
  var typeMap = schema.getTypeMap();
  Object.keys(typeMap).forEach(function (typeName) {
    var type = typeMap[typeName];

    // TODO: maybe have an option to include these?
    if (!(0, _type.getNamedType)(type).name.startsWith('__') && type instanceof _type.GraphQLObjectType) {
      (function () {
        var fields = type.getFields();
        Object.keys(fields).forEach(function (fieldName) {
          var field = fields[fieldName];
          fn(field, typeName, fieldName);
        });
      })();
    }
  });
}

// takes a GraphQL-JS schema and an object of connectors, then attaches
// the connectors to the context by wrapping each query or mutation resolve
// function with a function that attaches connectors if they don't exist.
// attaches connectors only once to make sure they are singletons
function attachConnectorsToContext(schema, connectors) {
  if (!schema || !(schema instanceof _type.GraphQLSchema)) {
    throw new Error('schema must be an instance of GraphQLSchema. ' + 'This error could be caused by installing more than one version of GraphQL-JS');
  }

  if ((typeof connectors === 'undefined' ? 'undefined' : _typeof(connectors)) !== 'object') {
    var connectorType = typeof connectors === 'undefined' ? 'undefined' : _typeof(connectors);
    throw new Error('Expected connectors to be of type object, got ' + connectorType);
  }
  if (Object.keys(connectors).length === 0) {
    throw new Error('Expected connectors to not be an empty object');
  }
  if (Array.isArray(connectors)) {
    throw new Error('Expected connectors to be of type object, got Array');
  }
  if (schema._apolloConnectorsAttached) {
    throw new Error('Connectors already attached to context, cannot attach more than once');
  }
  // eslint-disable-next-line no-param-reassign
  schema._apolloConnectorsAttached = true;
  var attachconnectorFn = function attachconnectorFn(root, args, ctx) {
    if ((typeof ctx === 'undefined' ? 'undefined' : _typeof(ctx)) !== 'object') {
      // if in any way possible, we should throw an error when the attachconnectors
      // function is called, not when a query is executed.
      var contextType = typeof ctx === 'undefined' ? 'undefined' : _typeof(ctx);
      throw new Error('Cannot attach connector because context is not an object: ' + contextType);
    }
    if (typeof ctx.connectors === 'undefined') {
      // eslint-disable-next-line no-param-reassign
      ctx.connectors = {};
    }
    Object.keys(connectors).forEach(function (connectorName) {
      // eslint-disable-next-line no-param-reassign
      ctx.connectors[connectorName] = new connectors[connectorName](ctx);
    });
    return root;
  };
  addSchemaLevelResolveFunction(schema, attachconnectorFn);
}

// wraps all resolve functions of query, mutation or subscription fields
// with the provided function to simulate a root schema level resolve funciton
function addSchemaLevelResolveFunction(schema, fn) {
  // TODO test that schema is a schema, fn is a function
  var rootTypes = [schema.getQueryType(), schema.getMutationType(), schema.getSubscriptionType()].filter(function (x) {
    return !!x;
  });
  // XXX this should run at most once per request to simulate a true root resolver
  // for graphql-js this is an approximation that works with queries but not mutations
  var rootResolveFn = runAtMostOncePerTick(fn);
  rootTypes.forEach(function (type) {
    var fields = type.getFields();
    Object.keys(fields).forEach(function (fieldName) {
      fields[fieldName].resolve = wrapResolver(fields[fieldName].resolve, rootResolveFn);
    });
  });
}

function addResolveFunctionsToSchema(schema, resolveFunctions) {
  Object.keys(resolveFunctions).forEach(function (typeName) {
    var type = schema.getType(typeName);
    if (!type && typeName !== '__schema') {
      throw new SchemaError('"' + typeName + '" defined in resolvers, but not in schema');
    }

    Object.keys(resolveFunctions[typeName]).forEach(function (fieldName) {
      if (fieldName.startsWith('__')) {
        // this is for isTypeOf and resolveType and all the other stuff.
        // TODO require resolveType for unions and interfaces.
        type[fieldName.substring(2)] = resolveFunctions[typeName][fieldName];
        return;
      }

      if (!type.getFields()[fieldName]) {
        throw new SchemaError(typeName + '.' + fieldName + ' defined in resolvers, but not in schema');
      }
      var field = type.getFields()[fieldName];
      var fieldResolve = resolveFunctions[typeName][fieldName];
      if (typeof fieldResolve === 'function') {
        // for convenience. Allows shorter syntax in resolver definition file
        setFieldProperties(field, { resolve: fieldResolve });
      } else {
        if ((typeof fieldResolve === 'undefined' ? 'undefined' : _typeof(fieldResolve)) !== 'object') {
          throw new SchemaError('Resolver ' + typeName + '.' + fieldName + ' must be object or function');
        }
        setFieldProperties(field, fieldResolve);
      }
    });
  });
}

function setFieldProperties(field, propertiesObj) {
  Object.keys(propertiesObj).forEach(function (propertyName) {
    // eslint-disable-next-line no-param-reassign
    field[propertyName] = propertiesObj[propertyName];
  });
}

function assertResolveFunctionsPresent(schema) {
  var resolverValidationOptions = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];
  var _resolverValidationOp = resolverValidationOptions.requireResolversForArgs;
  var requireResolversForArgs = _resolverValidationOp === undefined ? true : _resolverValidationOp;
  var _resolverValidationOp2 = resolverValidationOptions.requireResolversForNonScalar;
  var requireResolversForNonScalar = _resolverValidationOp2 === undefined ? true : _resolverValidationOp2;


  forEachField(schema, function (field, typeName, fieldName) {
    // requires a resolve function on every field that has arguments
    if (requireResolversForArgs && field.args.length > 0) {
      expectResolveFunction(field, typeName, fieldName);
    }

    // requires a resolve function on every field that returns a non-scalar type
    if (requireResolversForNonScalar && !((0, _type.getNamedType)(field.type) instanceof _type.GraphQLScalarType)) {
      expectResolveFunction(field, typeName, fieldName);
    }
  });
}

function expectResolveFunction(field, typeName, fieldName) {
  if (!field.resolve) {
    throw new SchemaError('Resolve function missing for "' + typeName + '.' + fieldName + '"');
  }
  if (typeof field.resolve !== 'function') {
    throw new SchemaError('Resolver "' + typeName + '.' + fieldName + '" must be a function');
  }
}

function addErrorLoggingToSchema(schema, logger) {
  if (!logger) {
    throw new Error('Must provide a logger');
  }
  if (typeof logger.log !== 'function') {
    throw new Error('Logger.log must be a function');
  }
  forEachField(schema, function (field, typeName, fieldName) {
    var errorHint = typeName + '.' + fieldName;
    // eslint-disable-next-line no-param-reassign
    field.resolve = decorateWithLogger(field.resolve, logger, errorHint);
  });
}

function wrapResolver(innerResolver, outerResolver) {
  return function (obj, args, ctx, info) {
    var root = outerResolver(obj, args, ctx, info);
    if (innerResolver) {
      return innerResolver(root, args, ctx, info);
    }
    return defaultResolveFn(root, args, ctx, info);
  };
}
/*
 * fn: The function to decorate with the logger
 * logger: an object instance of type Logger
 * hint: an optional hint to add to the error's message
 */
function decorateWithLogger(fn, logger) {
  var hint = arguments.length <= 2 || arguments[2] === undefined ? '' : arguments[2];

  if (typeof fn === 'undefined') {
    // eslint-disable-next-line no-param-reassign
    fn = defaultResolveFn;
  }
  return function () {
    try {
      return fn.apply(undefined, arguments);
    } catch (e) {
      // TODO: clone the error properly
      var newE = new Error();
      newE.stack = e.stack;
      if (hint) {
        newE.originalMessage = e.message;
        newE.message = 'Error in resolver ' + hint + '\n' + e.message;
      }
      logger.log(newE);
      // we want to pass on the error, just in case.
      throw e;
    }
  };
}

function addCatchUndefinedToSchema(schema) {
  forEachField(schema, function (field, typeName, fieldName) {
    var errorHint = typeName + '.' + fieldName;
    // eslint-disable-next-line no-param-reassign
    field.resolve = decorateToCatchUndefined(field.resolve, errorHint);
  });
}

function decorateToCatchUndefined(fn, hint) {
  if (typeof fn === 'undefined') {
    // eslint-disable-next-line no-param-reassign
    fn = defaultResolveFn;
  }
  return function () {
    var result = fn.apply(undefined, arguments);
    if (typeof result === 'undefined') {
      throw new Error('Resolve function for "' + hint + '" returned undefined');
    }
    return result;
  };
}

// XXX this function needs a shim to work in the browser
function runAtMostOncePerTick(fn) {
  var count = 0;
  var value = void 0;
  return function () {
    if (count === 0) {
      value = fn.apply(undefined, arguments);
      count += 1;
      process.nextTick(function () {
        count = 0;
      });
    }
    return value;
  };
}

/**
 * XXX taken from graphql-js: src/execution/execute.js, because that function
 * is not exported
 *
 * If a resolve function is not given, then a default resolve behavior is used
 * which takes the property of the source object of the same name as the field
 * and returns it as the result, or if it's a function, returns the result
 * of calling that function.
 */
function defaultResolveFn(source, args, context, _ref2) {
  var fieldName = _ref2.fieldName;

  // ensure source is a value for which property access is acceptable.
  if ((typeof source === 'undefined' ? 'undefined' : _typeof(source)) === 'object' || typeof source === 'function') {
    var property = source[fieldName];
    return typeof property === 'function' ? source[fieldName]() : property;
  }
  return undefined;
}

exports.generateSchema = generateSchema;
exports.makeExecutableSchema = makeExecutableSchema;
exports.SchemaError = SchemaError;
exports.forEachField = forEachField;
exports.addErrorLoggingToSchema = addErrorLoggingToSchema;
exports.addResolveFunctionsToSchema = addResolveFunctionsToSchema;
exports.addCatchUndefinedToSchema = addCatchUndefinedToSchema;
exports.assertResolveFunctionsPresent = assertResolveFunctionsPresent;
exports.buildSchemaFromTypeDefinitions = buildSchemaFromTypeDefinitions;
exports.addSchemaLevelResolveFunction = addSchemaLevelResolveFunction;
exports.attachConnectorsToContext = attachConnectorsToContext;