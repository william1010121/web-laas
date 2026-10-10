// Load dist/<name>.html into this document with the chrome stub in place.
const name = document.currentScript.dataset.page;
const bust = `?t=${Date.now()}`; // previews always load the latest build
fetch(`../../dist/${name}.html${bust}`, { cache: "no-store" }).then((r) => r.text()).then((html) => {
  const doc = new DOMParser().parseFromString(html.replace(/href="([\w.]+\.css)"/g, `href="../../dist/$1${bust}"`), "text/html");
  document.head.append(...[...doc.head.children].filter((n) => n.tagName !== "SCRIPT"));
  for (const s of doc.head.querySelectorAll("style")) document.head.append(s);
  document.body.innerHTML = doc.body.innerHTML.replace(/<script[^>]*><\/script>/g, "");
  const s = document.createElement("script");
  s.src = `../../dist/${name}.js${bust}`;
  document.body.append(s);
});
