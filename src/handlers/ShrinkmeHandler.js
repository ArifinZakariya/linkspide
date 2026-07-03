const BaseHandler = require("./BaseHandler");
const cheerio = require("cheerio");
const axios = require("axios");

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "https://shortlink-python.fly.dev";

class ShrinkmeHandler extends BaseHandler {
  get name() {
    return "shrinkme";
  }

  canHandle(url) {
    return /shrinkme\.io|shrinkme\.click|shrinke\.me|shorte\.st|sh\.st|adf\.ly|bc\.vc|exe\.io|tei\.ai|cuturl\.cc/.test(url);
  }

  async extract($, html, url) {
    if (/shrinkme\.click|shrinke\.me/.test(url)) {
      return await this.handleShrinkmeClick(url);
    }

    const form = $("form").first();
    if (form.length) {
      const action = form.attr("action");
      if (action && action !== "#") {
        const formData = {};
        form.find("input[name]").each((_, el) => {
          formData[$(el).attr("name")] = $(el).val() || "";
        });
        if (Object.keys(formData).length > 0) {
          return {
            formAction: action.startsWith("http") ? action : new URL(action, url).href,
            formData,
          };
        }
      }
    }

    return null;
  }

  async handleShrinkmeClick(url) {
    try {
      const resp = await axios.post(
        `${PYTHON_SERVICE_URL}/api/shrinkme`,
        { url },
        { timeout: 60000 }
      );

      if (resp.data?.success && resp.data?.url) {
        return { redirect: resp.data.url };
      }
      return null;
    } catch (e) {
      console.error("[ShrinkmeHandler] Python service error:", e.message);
      return null;
    }
  }
}

module.exports = ShrinkmeHandler;
