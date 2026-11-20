(function () {
  'use strict';
  const { element: el, setRichText } = window.ResumeDOM;

  function create({ pages, scroll, count }) {
    function fit() {
      if (matchMedia('print').matches) return;
      const styles = getComputedStyle(scroll);
      const available =
        scroll.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
      const paper = pages.querySelector('.sheet');
      const width = paper ? parseFloat(getComputedStyle(paper).width) : (210 * 96) / 25.4;
      const zoom = String(Math.min(1, Math.max(0.1, available / width)));
      if (pages.style.zoom !== zoom) pages.style.zoom = zoom;
    }
    function textSlice(source, start, end) {
      const copy = source.cloneNode(true);
      function point(offset) {
        const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
        let n, last;
        while ((n = walker.nextNode())) {
          last = n;
          if (offset <= n.length) return [n, offset];
          offset -= n.length;
        }
        return last ? [last, last.length] : [copy, 0];
      }
      const tail = document.createRange();
      tail.selectNodeContents(copy);
      tail.setStart(...point(end));
      tail.deleteContents();
      const head = document.createRange();
      head.selectNodeContents(copy);
      head.setEnd(...point(start));
      head.deleteContents();
      return copy;
    }
    function render(data, { printing = false } = {}) {
      document.documentElement.style.setProperty('--paper-font', `${data.fontSize}px`);
      const scrollTop = scroll.scrollTop;
      pages.style.zoom = '1';
      pages.replaceChildren();
      let sheet, content;
      function newPage() {
        sheet = el('article', 'sheet');
        sheet.setAttribute('aria-label', `简历第 ${pages.children.length + 1} 页`);
        content = el('div', 'sheet-content');
        sheet.append(content);
        pages.append(sheet);
      }
      newPage();
      const overflow = () => content.scrollHeight > content.clientHeight;
      function carryHeadings() {
        const trailing = [];
        while (content.lastElementChild?.matches('.keep-next')) {
          trailing.unshift(content.lastElementChild);
          content.lastElementChild.remove();
        }
        if (content.children.length) newPage();
        content.append(...trailing);
      }
      function place(node) {
        content.append(node);
        if (!overflow()) return;
        const height = node.offsetHeight;
        node.remove();
        // Paragraphs shorter than a page move intact, with their preceding headings.
        if (height <= content.clientHeight) {
          carryHeadings();
          content.append(node);
          if (!overflow()) return;
          node.remove();
        }
        if (!node.matches('.resume-text,.resume-bullet')) {
          content.append(node);
          return;
        }
        // A single paragraph longer than a page must continue on the next page.
        // Binary search fits complete rendered lines; Range keeps inline formatting.
        const chars = Array.from(node.textContent),
          offsets = [0];
        for (const c of chars) offsets.push(offsets.at(-1) + c.length);
        let start = 0;
        while (start < chars.length) {
          let lo = start,
            hi = chars.length,
            probe;
          while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            probe = textSlice(node, offsets[start], offsets[mid]);
            content.append(probe);
            const fits = !overflow();
            probe.remove();
            if (fits) lo = mid;
            else hi = mid - 1;
          }
          if (lo === start) {
            carryHeadings();
            continue;
          }
          // Keep a heading with at least two lines of its paragraph when possible.
          probe = textSlice(node, offsets[start], offsets[lo]);
          content.append(probe);
          if (
            start === 0 &&
            lo < chars.length &&
            probe.offsetHeight < Number(data.fontSize) * 3 &&
            probe.previousElementSibling?.matches('.keep-next')
          ) {
            probe.remove();
            carryHeadings();
            continue;
          }
          if (start > 0) probe.classList.add('continued');
          start = lo;
          if (start < chars.length) newPage();
        }
      }
      function group(nodes) {
        if (!nodes.length) return;
        const block = el('div', 'resume-block');
        block.append(...nodes);
        content.append(block);
        if (!overflow()) return;
        const fitsOnEmptyPage = block.offsetHeight <= content.clientHeight;
        block.remove();
        if (fitsOnEmptyPage) {
          carryHeadings();
          content.append(block);
          if (!overflow()) return;
          block.remove();
        }
        // Oversize entries may span pages, but each ordinary paragraph stays intact.
        for (const node of nodes) place(node);
      }
      function paragraph(line, cls) {
        const p = el('p', cls);
        return setRichText(p, line);
      }
      function heading(title) {
        return el('h2', 'resume-section keep-next', title);
      }
      const header = el('header', 'resume-header');
      if (data.name.trim()) header.append(el('h1', '', data.name));
      function metaRow(cls, items) {
        const row = el('div', cls);
        for (const [label, value] of items)
          if (value?.trim()) row.append(el('span', '', `${label}：${value}`));
        if (row.children.length) header.append(row);
      }
      metaRow('contacts', [
        ['电话', data.phone],
        ['邮箱', data.email],
        ['现居城市', data.city],
        ['个人主页', data.website],
      ]);
      metaRow('resume-role', [
        ['求职意向', data.role],
        ['期望薪资', data.salary],
      ]);
      if (header.children.length) group([header]);
      if (data.summary.trim())
        group([
          heading('个人总结'),
          ...data.summary
            .split('\n')
            .filter((v) => v.trim())
            .map((line) => paragraph(line, 'resume-text')),
        ]);
      for (const s of window.ResumeData.orderedSections(data)) {
        if (s.hidden) continue;
        let first = true;
        for (const entry of s.entries) {
          if (
            ![entry.title, entry.date, entry.body, entry.subtitle, entry.location].some((v) =>
              v?.trim(),
            )
          )
            continue;
          const nodes = [];
          if (first && s.title.trim()) nodes.push(heading(s.title));
          first = false;
          if (entry.title.trim() || entry.date.trim()) {
            const h = el('div', 'resume-entry keep-next'),
              title = el('span', 'entry-title');
            setRichText(title, entry.title);
            h.append(title);
            if (entry.date.trim()) h.append(el('span', 'date', entry.date));
            nodes.push(h);
          }
          if (entry.subtitle?.trim() || entry.location?.trim()) {
            const meta = el('div', 'resume-entry-meta keep-next');
            meta.append(el('span', '', entry.subtitle || ''));
            if (entry.location?.trim()) meta.append(el('span', 'entry-location', entry.location));
            nodes.push(meta);
          }
          for (const line of entry.body.split('\n').filter((v) => v.trim()))
            nodes.push(paragraph(line.replace(/^[-•]\s*/, ''), 'resume-bullet'));
          // A title without body is itself content, rather than a heading to carry.
          if (nodes.at(-1)?.matches('.resume-entry,.resume-entry-meta'))
            nodes.at(-1).classList.remove('keep-next');
          group(nodes);
        }
      }
      if (!content.children.length && pages.children.length === 1) {
        const empty = el('div', 'empty-preview');
        empty.append(el('p', '', '在左侧填写内容'));
        content.append(empty);
      }
      for (const [i, page] of [...pages.children].entries())
        page.dataset.pageLabel = `${i + 1} / ${pages.children.length}`;
      count.textContent = `${pages.children.length} 页`;
      if (!printing) fit();
      scroll.scrollTop = scrollTop;
    }

    return Object.freeze({ render, fit });
  }
  window.ResumePreview = Object.freeze({ create });
})();
