/*
 * 2. to convert markdown to html
 * 3. handlebars is used to convert `{{ }}` placeholders
 *    in markdown, html, to output
 * 4. brings in our own shared `utils`
 */
var fs = require('fs');
var path = require('path');
var md = require('markdown-it')({ html: true }); /* 2 */
var Handlebars = require('handlebars'); /* 3 */
var utils = require('../util/template-utils.js'); /* 4 */

require('events').EventEmitter.prototype._maxListeners = 100;

function traverse(obj, str) {
  return str.split(".").reduce(function(o, x) { return o[x] }, obj);
}

/*
  generateContentAndTemplates()
  =============
  This function wraps some lookups and caching around otherwise repeated actions
  within the run of the task returned.

  In general, the purpose is to:
  - take incoming Markdown files** and inject in dictionary variables
  - render the post-processed Markdown in to HTML
  - fetch the appropriate template (HTML)
  - Inject in dictionary variables and feed the HTML **content** (from markdown)
    in to the template.
  - Return the final combined HTML through to the vinyl stream.

  ** later, we want to accept incoming HTML partials as well
     (not all pages will be Markdown based)

  Returns: a gulp-friendly pipe task (function)
*/
function generateContentAndTemplates() {
  var base, projectJSON, i18nJSON, hbsTemplates, LocalHandlebars;

  /*
   * cache variables and lookups used on subsequent runs of the pipe task:
   *
   * 1. `base` directory of project
   * 2. `contentBase` is the root directory where the task is getting its content,
   *     this is helpful later for processing out which i18n we're looking at
   * 3. `projectJSON` is global, re-used across all languages
   * 4. `i18nJSON` caches the template JSON for each language (avoids duplicated work)
   * 5. `hbsTemplates` caches the handlebars FUNCTION for each template to save overhead
   * 5. `LocalHandlebars` is a sandboxed version of Handlebars, avoids injecting
         helpers and partials at a global scale.
   */
  base = path.resolve(__dirname, '..', '..'); /* 1 */
  contentBase = path.resolve(base, 'content'); /* 2 */
  projectJSON = require('../../source/project.js'); /* 3 */
  i18nJSON = {}; /* 4 */
  hbsTemplates = {}; /* 5 */
  LocalHandlebars = Handlebars.create() /* 6 */

  LocalHandlebars.registerPartial('current_download_links', `{{#project.current_version_downloads}}<a href="{{url}}">{{i18n "downloads" key}}</a>{{/project.current_version_downloads}}`)

  LocalHandlebars.registerHelper('i18n', function() {
    var scope, i18n_key, env, key, data, lang, result;

    var args = Array.prototype.slice.call(arguments);

    if (args.length === 2) {
      scope = null;
      i18n_key = args[0];
      env = args[1];
      key = i18n_key;
    }
    if (args.length === 3) {
      scope = args[0];
      i18n_key = args[1];
      env = args[2];
      key = [scope, i18n_key].join('.');
    }

    data = env.data.root;
    lang = data.lang;
    result = traverse(data.i18n, key);

    return new Handlebars.SafeString(result);
  });

  LocalHandlebars.registerHelper('hb', function() {
    var scope, i18n_key, env, key, data, lang, result;

    var args = Array.prototype.slice.call(arguments);

    if (args.length === 2) {
      scope = null;
      i18n_key = args[0];
      env = args[1];
      key = i18n_key;
    }
    if (args.length === 3) {
      scope = args[0];
      i18n_key = args[1];
      env = args[2];
      key = [scope, i18n_key].join('.');
    }

    data = env.data.root;
    lang = data.lang;
    result = traverse(data.i18n, key);

    result = LocalHandlebars.compile(result)(env.data.root);

    return new Handlebars.SafeString(result);
  });

  LocalHandlebars.registerHelper('link', function(text, url, env) {
    var key = text;

    if (arguments.length == 2) {
      env = url;
      text = traverse(env.data.root.i18n.links, key);
      url = traverse(env.data.root.project.links, key);
    }
    text = Handlebars.Utils.escapeExpression(text);
    url  = Handlebars.Utils.escapeExpression(url);

    var result = '<a href="' + url + '">' + text + '</a>';

    return new Handlebars.SafeString(result);
  });

  // we returned a wrapped function to help us cache some work (above)
  return function(contentBuffer, file) {
    var fileName, fileType, contentRaw, lang, templateJSON, contentHandlebarsCompiled,
        contentMarkdownCompiled, template, contentTemplateCompiled;

    fileName = path.parse(file).name
    fileType = path.parse(file).ext === ".html" ? "html" : "markdown"
    contentRaw = contentBuffer.toString();

    // determine the language based off of the current path
    lang = path.relative(contentBase, path.dirname(file)).split(path.sep)[0];

    if (i18nJSON[lang] == null) {
      i18nJSON[lang] = utils.loadTemplateJSON(lang);
    }

    // load the current dictionary for the selected lang
    templateJSON = {
      i18n: i18nJSON[lang],
      lang: lang,
      build: {
        markdownPage: fileName,
        pageStylesheet: fileName
      },
      page: {
        languages: projectJSON.languages.map(function(lang) {
          return {
            code: lang.code,
            name: lang.name,
            url: `/${lang.code}/${fileName}.html`
          }
        })
      },
      project: projectJSON
    }

    // initial Handlebars compile, Markdown content, before parsing
    // (otherwise the `{{ }}` can be escaped)
    contentHandlebarsCompiled = LocalHandlebars.compile(contentRaw)(templateJSON);

    // When required, turn `.md` in to `.html`
    if (fileType === "markdown") {
      contentMarkdownCompiled = md.render(contentHandlebarsCompiled);
    } else {
      contentMarkdownCompiled = contentHandlebarsCompiled;
    }

    // this is hard-coded right now, but planned to be dynamic:
    template = 'main.html';

    // fetch the final template function we need (if not already cached)
    if (hbsTemplates[template] == null) {
      var templateBody =  fs.readFileSync(path.join(base, 'source', 'templates', template), {encoding: 'utf8'});
      hbsTemplates[template] = LocalHandlebars.compile(templateBody);
    }

    // Adds the inner-content already processed to the templateJSON
    // as the dictionaries may be re-used between both levels:
    templateJSON.content = contentMarkdownCompiled;

    // Compile a version of the template with the content inside:
    contentTemplateCompiled = hbsTemplates[template](templateJSON)

    // Return as a Buffer for additional processing:
    return new Buffer(contentTemplateCompiled);
  }
};

module.exports = {
  generateContentAndTemplates: generateContentAndTemplates
}