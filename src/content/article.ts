// Lightweight main-content detection (in the spirit of Readability, but working on
// the live DOM so highlights can point at the original text).

const POSITIVE = /article|body|content|entry|main|page|post|story|text|blog|prose/i;
const NEGATIVE = /comment|meta|footer|footnote|sidebar|side-bar|nav|menu|share|social|related|promo|advert|ad-|banner|cookie|subscribe|newsletter|popup|modal|breadcrumb/i;

function classWeight(el: Element): number {
  const s = `${el.id} ${el.className && typeof el.className === 'string' ? el.className : ''}`;
  let w = 0;
  if (POSITIVE.test(s)) w += 25;
  if (NEGATIVE.test(s)) w -= 25;
  return w;
}

function paragraphText(el: Element): number {
  let n = 0;
  for (const p of el.querySelectorAll('p')) n += p.textContent?.length ?? 0;
  return n;
}

/**
 * Returns the nodes that make up the main article, in document order, or null when
 * no convincing candidate is found (caller then reads the whole page).
 */
export function findArticleRoots(doc: Document = document): Element[] | null {
  const scores = new Map<Element, number>();
  const add = (el: Element | null, score: number) => {
    if (!el || el === doc.documentElement) return;
    if (!scores.has(el)) scores.set(el, classWeight(el));
    scores.set(el, scores.get(el)! + score);
  };

  for (const p of doc.querySelectorAll('p, pre, blockquote, li, td')) {
    const text = (p.textContent ?? '').trim();
    if (text.length < 25) continue;
    // List items and cells count less: they are often menus and tables.
    const weight = p.tagName === 'P' || p.tagName === 'PRE' || p.tagName === 'BLOCKQUOTE' ? 1 : 0.3;
    const score = weight * (1 + (text.match(/[,，]/g)?.length ?? 0) + Math.min(text.length / 100, 3));
    add(p.parentElement, score);
    add(p.parentElement?.parentElement ?? null, score / 2);
    add(p.parentElement?.parentElement?.parentElement ?? null, score / 3);
  }

  let best: Element | null = null;
  let bestScore = 0;
  const top = [...scores].sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [el, score] of top) {
    // Penalise link-heavy containers (navigation, link lists).
    const text = el.textContent?.length ?? 0;
    let linkText = 0;
    for (const a of el.querySelectorAll('a')) linkText += a.textContent?.length ?? 0;
    const adjusted = score * (1 - Math.min(linkText / Math.max(text, 1), 1));
    if (adjusted > bestScore) {
      best = el;
      bestScore = adjusted;
    }
  }

  // Widen to a semantic <article>/<main> wrapper only when the winner holds just part
  // of its paragraphs (content split across sibling sections).
  const semantic = best?.closest('article, main, [role="main"]');
  if (semantic && best && semantic !== best && paragraphText(best) < paragraphText(semantic) * 0.8) {
    best = semantic;
  }
  if (!best || (best.textContent?.trim().length ?? 0) < 200) {
    best = doc.querySelector('article, main, [role="main"]');
    if (!best || (best.textContent?.trim().length ?? 0) < 200) return null;
  }

  // Include the page headline when it sits just before the article body.
  const roots: Element[] = [best];
  const h1 = doc.querySelector('h1');
  if (h1 && !best.contains(h1) && h1.compareDocumentPosition(best) & Node.DOCUMENT_POSITION_FOLLOWING) {
    roots.unshift(h1);
  }
  return roots;
}
