const BaseHandler = require("./BaseHandler");

class CountdownHandler extends BaseHandler {
  get name() {
    return "countdown";
  }

  canHandle(url) {
    return /countdown|timer|wait|redirect|skip/i.test(url);
  }

  async extract($, html, url) {
    const countdown = $('[id*="countdown"], [class*="countdown"], [id*="timer"], [class*="timer"]');
    if (countdown.length === 0) return null;

    const redirectAttr =
      countdown.attr("data-url") ||
      countdown.attr("data-href") ||
      countdown.attr("data-redirect");
    if (redirectAttr) return { redirect: redirectAttr };

    const scriptRedirect = html.match(
      /(?:setTimeout|setInterval)\s*\(\s*(?:function\s*\(\)\s*\{?\s*(?:window\.location(?:\.href)?\s*=\s*|location\.href\s*=\s*|location\.replace\s*\())\s*["']([^"']+)/
    );
    if (scriptRedirect) return { redirect: scriptRedirect[1] };

    return null;
  }
}

module.exports = CountdownHandler;
