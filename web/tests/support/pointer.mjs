/** Click a control the way a pointer does, and fail when something else is on top. */

export function controlFinder(label, scope = "document") {
  const encoded = JSON.stringify(label);
  return `[...${scope}.querySelectorAll("button, a, [role='button'], [role='checkbox'], input, textarea")].find((el) => ((el.innerText || "").replace(/\\s+/g, " ").trim() === ${encoded} || el.getAttribute("aria-label") === ${encoded} || el.id === ${encoded}))`;
}

export async function pointerClick(send, evalPage, finder, times = 1) {
  const hit = await evalPage(
    send,
    `(() => {
      const el = ${finder};
      if (!el || !(el instanceof Element)) return { ok: false, reason: "missing" };
      const probe = () => {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const top = document.elementFromPoint(x, y);
        const onScreen = x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight;
        return {
          ok: Boolean(top && (top === el || el.contains(top)) && rect.width >= 1 && rect.height >= 1 && onScreen),
          x,
          y,
          hit: top ? top.getAttribute("aria-label") || (top.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 80) || top.tagName : "",
        };
      };
      let point = probe();
      if (!point.ok) {
        el.scrollIntoView({ block: "center", inline: "center" });
        point = probe();
      }
      return point;
    })()`,
  );
  if (!hit || hit.ok !== true) throw new Error(`pointer missed ${finder}: ${JSON.stringify(hit)}`);
  for (let count = 0; count < times; count += 1) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hit.x, y: hit.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: hit.x, y: hit.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: hit.x, y: hit.y, button: "left", clickCount: 1 });
  }
  return "yes";
}

export function pressLabel(send, evalPage, label, scope) {
  return pointerClick(send, evalPage, controlFinder(label, scope));
}
