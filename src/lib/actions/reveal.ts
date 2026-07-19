/**
 * Scroll-reveal Svelte action. Progressive enhancement only: the element is
 * hidden (`.pre`) exclusively after JS runs and when the user allows motion,
 * so content is never invisible without JS or with reduced motion.
 *
 * Usage: `<section use:reveal>` or `use:reveal={{ delay: 120 }}`.
 */
export function reveal(el: HTMLElement, opts: { delay?: number } = {}) {
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
	if (!('IntersectionObserver' in window)) return;

	el.classList.add('pre');
	if (opts.delay) el.style.transitionDelay = `${opts.delay}ms`;

	const io = new IntersectionObserver(
		(entries) => {
			for (const e of entries) {
				if (e.isIntersecting) {
					el.classList.add('in');
					io.disconnect();
				}
			}
		},
		{ threshold: 0.18, rootMargin: '0px 0px -40px 0px' }
	);
	io.observe(el);

	return {
		destroy() {
			io.disconnect();
		}
	};
}
