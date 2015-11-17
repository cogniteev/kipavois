# KiPavois

KiPavois is an HTTP proxy rewriting Elasticsearch queries made by Kibana 4
to provide data isolation across different users.

To use this, you need an upstream application taking care of authentication,
and that specify a special HTTP header (by default `x-kibana-user`) expected by
KiPavois.

## Usage

### Docker image

KiPavois is delivered as a Docker image.
```shell
docker pull cogniteev/kipavois
```

### Command-line use

You can install the NPM package:

```
npm install -g kipavois
kipavois --help
```

## Synopsys

```
Usage: kipavois [options]

Options:

  -h, --help                             output usage information
  -u, --kibana-user-header <header>      HTTP header used to get the Kibana user (defaults to `x-kibana-user`)
  -r, --kibana-user-header-regex <regex> regular expression that should be applied on the HTTP header in order to get the list of allowed Kibana users (single value or a comma separated list is accepted by default: '([^,]+),?' )
  -f, --filtered-field <field>           Name of the Elasticsearch field to filter on (defaults to `user`).
  -s, --server <host:port>               Elasticsearch endpoint (default to `elasticsearch:9200`)
  -p, --port <port>                      Listening port (default to `8000`)
```

## Behavior

If the `x-kibana-user` HTTP header is specified, then the proxy:

* Modifies body of certain queries
* Forbid Kibana administrative operations.

#### Filters

An additional *term* filter is added to queries specified in the body of
`POST /_msearch` operation. It uses the field specified in the
`--filtered-field` command line option. Term values are passed in the
`x-kibana-user` HTTP header. The value can be a valid JSON expression
(an array of string for instance), or a plain text value.

#### Blocked operations

It is not possible to:

* update Kibana configuration
* create, update, or remove dashboards.

## License

`KiPavois` is licensed under the Apache License, Version 2.0.
See [LICENSE](LICENSE) file for full license text.
