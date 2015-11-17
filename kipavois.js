var http = require('http'),
    bodyParser = require('body-parser'),
    connect = require('connect'),
    fs = require('fs'),
    httpProxy = require('http-proxy'),
    Type = require('type-of-is'),
    winston = require('winston');
require('prototypes');

module.exports = function(options) {
    var kibanaUserHeader = options.kibanaUserHeader || 'x-kibana-user',
        kibanaUserHeaderRegex = options.kibanaUserHeaderRegex || '([^,]+),?',
        kibanaUserField = options.kibanaUserField || 'user',
        elasticsearchEndpoint = options.elasticsearchEndpoint || 'elasticsearch:9200',
        listenPort = options.listenPort || 8000,
        proxy = httpProxy.createProxyServer({
            target: 'http://' + elasticsearchEndpoint
        }),
        logger = new (winston.Logger)({
          transports: [
            new (winston.transports.Console)()
          ]
        }),
        parse_msearch = function(raw, onError) {
          query = null;
          queries = [];
          lines = raw.split('\n');
          for (var i = 0 ; i < lines.length ; i++) {
            if (lines[i].length === 0) {
              continue;
            }
            if (query == null) {
              try {
                query = JSON.parse(lines[i]);
              } catch (e) {
                onError(e, "parsing query indices: " + escape(lines[i]))
              }
            } else {
              try {
                body = JSON.parse(lines[i])
              } catch (e) {
                onError(e, "parsing query" + escape(lines[i]))
              }
              queries.push({
                'query': query,
                'body': body
              });
              query = null;
            }
          }
          return queries;
        },
        add_term_filter_msearch = function(q, term, value, onError) {
          query = q.body.query;
          if (query == undefined) {
            return onError('No "query" field in body');
          }
          filtered = query.filtered;
          if (filtered == undefined) {
            return onError('No "filtered" field in body.query');
          }
          filter = filtered.filter;
          if (filter == undefined) {
            return onError('No "filter" field in body.query.filtered');
          }
          bool_filter = filter.bool;
          if (bool_filter == undefined) {
            return onError('No "bool" field in body.query.filtered.bool')
          }
          if (bool_filter.must == undefined) {
            bool_filter.must = []
          } else if (!Type.is(bool_filter.must, Array)) {
            bool_filter.must = [bool_filter.must]
          }
          var newTerm = {}
          newTerm[term] = value
          if (value.length > 0) {
            bool_filter.must.push({
              'terms': newTerm
            })
          }
        },
        app = connect()
            .use(function(req, res, next) {
              logger.debug(req.method + " " + req.url)
              if (kibanaUserHeader in req.headers) {
                if (req.method == 'POST') {
                  if (req.url.startsWith('/_msearch')) {
                    // launch body rewrite
                    next();
                  } else if (req.url.startsWith('/.kibana/config') && req.url.endsWith('_update')) {
                    // non admin user is not allowed to modify the .kibana index
                    res.statusCode = 403
                    res.end()
                  } else if (req.url.startsWith('/.kibana/dashboard/') && req.url.endsWith('op_type=create')) {
                    // Cannot create or update a dashboard
                    res.statusCode = 403
                    res.end()
                  } else {
                    proxy.web(req, res, function(e) {
                      logger.error(e)
                      res.statusCode = 500
                      res.end();
                    });
                  }
                } else if (req.method == 'DELETE') {
                  // Objects cannot be deleted
                  res.statusCode = 403
                  res.end()
                } else {
                  proxy.web(req, res, function(e) {
                    logger.error(e)
                    res.statusCode = 500
                    res.end();
                  });
                }
              } else {
                proxy.web(req, res, function(e) {
                  logger.error(e)
                  res.statusCode = 500
                  res.end();
                });
              }
            })
            .use(function(req, res, next) {
              if (!('content-type' in req.headers)) {
                req.headers['content-type'] = 'text/plain'
              }
              next()
            })
            // consume body
            .use(bodyParser.text({type: '*/*'}))
            // rewrite body
            .use(function(req, res, next){
              if (!(Type.is(req.body, String))) {
                req.body = ""
              }
              queries = parse_msearch(req.body, function(message, context) {
                logger.error(message, {
                  method: req.method,
                  url: req.url,
                  body: req.body,
                  context: context
                })
              })
              newBody = ""
              queries.forEach(function(q) {
                try {
                  allowedTerms = JSON.parse(req.headers[kibanaUserHeader]);
                } catch (e) {
                  var kibanaUserHeaderValue = req.headers[kibanaUserHeader];
                  allowedTerms = []
                  var re = new RegExp(kibanaUserHeaderRegex, 'gmi');
                  var result = [];
                  while((result = re.exec(kibanaUserHeaderValue)) != null) {
                    allowedTerms.push(result[1]);
                  }
                }
                add_term_filter_msearch(q, kibanaUserField, allowedTerms, function(message) {
                  logger.error(message, {
                    method: req.method,
                    url: req.url,
                    body: req.body
                  })
                })
                newBody += JSON.stringify(q.query)
                newBody += '\n'
                newBody += JSON.stringify(q.body)
                newBody += '\n'
              });
              logger.info("new body: " + newBody)
              req.headers['content-length'] = newBody.length
              next()
            })
            // configure proxy pipelines and emit the new body
            .use(function(req, res) {
              proxy.web(req, res, function(e) {
                logger.error(e)
                res.statusCode = 500
                res.end();
              })
              req.emit('data', newBody)
            });
    var start_proxy = function() {
      console.log('Trying to bind to port ' + listenPort);
      http.createServer(app).listen(listenPort, function(){
        console.log('proxy listen ' + listenPort);
      });
    }

    return {
      start_proxy: start_proxy,
      parse_msearch: parse_msearch,
      add_term_filter_msearch: add_term_filter_msearch
    }
}
