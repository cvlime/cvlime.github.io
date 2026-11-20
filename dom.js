(function () {
  'use strict';

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Only **bold** is supported. User input never becomes executable HTML.
  function setRichText(node, value) {
    node.replaceChildren();
    const pattern = /\*\*([^*]+)\*\*/g;
    let offset = 0;
    for (const match of value.matchAll(pattern)) {
      node.append(document.createTextNode(value.slice(offset, match.index)));
      node.append(element('strong', '', match[1]));
      offset = match.index + match[0].length;
    }
    node.append(document.createTextNode(value.slice(offset)));
    return node;
  }

  window.ResumeDOM = Object.freeze({ element, setRichText });
})();
