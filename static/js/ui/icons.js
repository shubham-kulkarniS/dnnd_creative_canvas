/**
 * Centralised inline-SVG icon registry.
 *
 * Returns SVG strings sized at 16×16 (the canonical viewBox), with
 * `currentColor` strokes so icons inherit the surrounding text colour.
 * Pass `{ size }` to override; pass `{ class: '…' }` to attach a class.
 *
 * Stays as strings rather than DOM nodes so it composes cleanly inside
 * the many `innerHTML` template strings used elsewhere.
 */

const PATHS = {
    plus:
        `<path d="M8 3.25v9.5M3.25 8h9.5"
               stroke="currentColor" stroke-width="1.6"
               stroke-linecap="round"/>`,
    trash:
        `<path d="M3 4.5h10M6.5 4.5V3.25a.75.75 0 0 1 .75-.75h1.5
                  a.75.75 0 0 1 .75.75V4.5M5 4.5l.5 8.25a1 1 0 0 0 1 .94h3
                  a1 1 0 0 0 1-.94L11 4.5"
               stroke="currentColor" stroke-width="1.4" fill="none"
               stroke-linecap="round" stroke-linejoin="round"/>`,
    check:
        `<path d="M3.5 8.5l3 3 6-6"
               stroke="currentColor" stroke-width="1.6" fill="none"
               stroke-linecap="round" stroke-linejoin="round"/>`,
    chevron:
        `<path d="M5 6l3 3 3-3"
               stroke="currentColor" stroke-width="1.5" fill="none"
               stroke-linecap="round" stroke-linejoin="round"/>`,
    close:
        `<path d="M4 4l8 8M12 4l-8 8"
               stroke="currentColor" stroke-width="1.5"
               stroke-linecap="round"/>`,
    sessions:
        `<rect x="2.5" y="3" width="11" height="10" rx="1.5"
               fill="none" stroke="currentColor" stroke-width="1.4"/>
         <path d="M5 6h6M5 8.5h6M5 11h4"
               stroke="currentColor" stroke-width="1.2"
               stroke-linecap="round"/>`,
    assets:
        `<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"
               fill="none" stroke="currentColor" stroke-width="1.4"/>
         <circle cx="6" cy="6.5" r="1.2" fill="currentColor"/>
         <path d="M2.7 11.5l3.3-3 2.5 2.5 1.7-1.5 3 2.5"
               stroke="currentColor" stroke-width="1.2" fill="none"
               stroke-linejoin="round"/>`,
    bookmark:
        `<path d="M4.5 3h7v10l-3.5-2-3.5 2V3z"
               fill="none" stroke="currentColor" stroke-width="1.4"
               stroke-linejoin="round"/>`,
    note:
        `<path d="M3 3.75A.75.75 0 0 1 3.75 3h6.5a.75.75 0 0 1 .53.22l2 2
                  c.14.14.22.33.22.53V12.25a.75.75 0 0 1-.75.75H3.75A.75.75 0 0 1 3 12.25V3.75z"
               fill="none" stroke="currentColor" stroke-width="1.3"
               stroke-linejoin="round"/>
         <path d="M5.5 6.5h5M5.5 8.75h5M5.5 11h3"
               stroke="currentColor" stroke-width="1.2"
               stroke-linecap="round"/>`,
    play:
        `<path d="M5.5 4.5v7l6-3.5-6-3.5z"
               fill="currentColor"/>`,
    question:
        `<circle cx="8" cy="8" r="6"
                 fill="none" stroke="currentColor" stroke-width="1.4"/>
         <path d="M6.2 6.4c0-1.1.9-1.9 1.9-1.9s1.9.8 1.9 1.8c0 .8-.4 1.2-1.1 1.6
                  -.6.3-.9.6-.9 1.2v.4"
               stroke="currentColor" stroke-width="1.3" fill="none"
               stroke-linecap="round"/>
         <circle cx="8" cy="11.5" r="0.7" fill="currentColor"/>`,
};

export function icon(name, { size = 16, class: cls = '', ariaLabel } = {}) {
    const body = PATHS[name];
    if (!body) return '';
    const a11y = ariaLabel
        ? `role="img" aria-label="${ariaLabel}"`
        : 'aria-hidden="true"';
    const classAttr = cls ? ` class="${cls}"` : '';
    return `<svg${classAttr} width="${size}" height="${size}" viewBox="0 0 16 16"
                  xmlns="http://www.w3.org/2000/svg" ${a11y}>${body}</svg>`;
}

export function hasIcon(name) {
    return Object.prototype.hasOwnProperty.call(PATHS, name);
}
