const BaseHandler = require("./BaseHandler");

class TokenBypassHandler extends BaseHandler {
  get name() {
    return "token-bypass";
  }

  canHandle(url) {
    return true;
  }

  async extract($, html, url) {
    const token = html.match(/var\s+token\s*=\s*["']([^"']+)/);
    const dest = html.match(/var\s+(?:dest|url|link|goto)\s*=\s*["']([^"']+)/);
    const apiEndpoint = html.match(
      /(?:fetch|ajax|post|get)\s*\(\s*["']([^"']*api[^"']*)/
    );

    if (token && dest) {
      return { redirect: dest[1], token: token[1] };
    }

    const form = $('form[action]').first();
    if (form.length) {
      const action = form.attr("action");
      const inputs = {};
      form.find("input[name]").each((_, el) => {
        inputs[$(el).attr("name")] = $(el).attr("value") || "";
      });
      if (inputs["url"] || inputs["link"] || inputs["dest"]) {
        return { formAction: action, formData: inputs };
      }
    }

    return null;
  }
}

module.exports = TokenBypassHandler;
