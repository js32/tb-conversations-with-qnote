/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import { messageActions } from "../content/reducer/reducerMessages.mjs";

describe("Message Actions tests", () => {
  describe("clickIframe", () => {
    let topChromeWindow;
    let openDefaultBrowser;
    let oldOpenDefaultBrowser;

    function clickOn(html) {
      // eslint-disable-next-line no-unsanitized/property
      document.body.innerHTML = html;
      let event = new window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      document.body.addEventListener(
        "click",
        (e) => messageActions.clickIframe({ event: e })(),
        { once: true }
      );
      document.getElementById("target").dispatchEvent(event);
      return event;
    }

    beforeEach((t) => {
      topChromeWindow = {};
      // @ts-expect-error
      window.browsingContext = { topChromeWindow };
      oldOpenDefaultBrowser = browser.windows?.openDefaultBrowser;
      openDefaultBrowser = t.mock.fn();
      browser.windows ??= {};
      browser.windows.openDefaultBrowser = openDefaultBrowser;
    });

    afterEach(() => {
      browser.windows.openDefaultBrowser = oldOpenDefaultBrowser;
      // @ts-expect-error
      delete window.browsingContext;
    });

    it("should open http(s) links in the default browser", () => {
      let event = clickOn(
        '<a href="https://example.com/page"><span id="target">link</span></a>'
      );

      assert.equal(event.defaultPrevented, true);
      assert.equal(openDefaultBrowser.mock.calls.length, 1);
      assert.deepEqual(openDefaultBrowser.mock.calls[0].arguments, [
        "https://example.com/page",
      ]);
    });

    it("should leave other protocols to Thunderbird", () => {
      let event = clickOn('<a id="target" href="mailto:a@example.com">m</a>');

      assert.equal(event.defaultPrevented, false);
      assert.equal(openDefaultBrowser.mock.calls.length, 0);
    });

    it("should ignore clicks that are not on links", () => {
      let event = clickOn('<p id="target">text</p>');

      assert.equal(event.defaultPrevented, false);
      assert.equal(openDefaultBrowser.mock.calls.length, 0);
    });

    it("should use contentAreaClick where Thunderbird still provides it", (t) => {
      topChromeWindow.contentAreaClick = t.mock.fn(() => false);

      let event = clickOn('<a id="target" href="https://example.com/">l</a>');

      assert.equal(topChromeWindow.contentAreaClick.mock.calls.length, 1);
      assert.equal(event.defaultPrevented, true);
      assert.equal(openDefaultBrowser.mock.calls.length, 0);
    });
  });
});
