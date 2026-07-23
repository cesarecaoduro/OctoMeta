/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const worker = self as unknown as ServiceWorkerGlobalScope;
const ASSET_CACHE = `octometa-assets-${version}`;
const OWNER_PAGE_CACHE = `octometa-owner-pages-${version}`;
const SHIPPED_ASSETS = [...build, ...files];

function isOwnerRoute(pathname: string): boolean {
	return pathname === '/app' || pathname.startsWith('/app/');
}

worker.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(ASSET_CACHE);
			await cache.addAll(SHIPPED_ASSETS);
			await worker.skipWaiting();
		})()
	);
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const retained = new Set([ASSET_CACHE, OWNER_PAGE_CACHE]);
			await Promise.all(
				(await caches.keys())
					.filter((name) => name.startsWith('octometa-') && !retained.has(name))
					.map((name) => caches.delete(name))
			);
			await worker.clients.claim();
		})()
	);
});

async function ownerNavigation(request: Request): Promise<Response> {
	const cache = await caches.open(OWNER_PAGE_CACHE);
	try {
		const response = await fetch(request);
		if (response.ok && !response.redirected) await cache.put(request, response.clone());
		return response;
	} catch {
		const cached = await cache.match(request);
		if (cached) return cached;
		return new Response('This owner workspace has not been opened on this device.', {
			status: 503,
			headers: { 'Content-Type': 'text/plain; charset=utf-8' }
		});
	}
}

async function cacheOwnerRoute(rawUrl: string): Promise<void> {
	const url = new URL(rawUrl, worker.location.origin);
	if (url.origin !== worker.location.origin || !isOwnerRoute(url.pathname)) return;
	const request = new Request(url, {
		credentials: 'same-origin',
		headers: { Accept: 'text/html' }
	});
	const response = await fetch(request);
	if (!response.ok || response.redirected) return;
	await (await caches.open(OWNER_PAGE_CACHE)).put(request, response);
}

worker.addEventListener('message', (event) => {
	const message = event.data as { type?: unknown; url?: unknown } | null;
	if (
		message?.type !== 'cache-owner-route' ||
		typeof message.url !== 'string'
	) {
		return;
	}
	event.waitUntil(cacheOwnerRoute(message.url));
});

worker.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== worker.location.origin) return;

	if (request.mode === 'navigate' && isOwnerRoute(url.pathname)) {
		event.respondWith(ownerNavigation(request));
		return;
	}
	if (SHIPPED_ASSETS.includes(url.pathname)) {
		event.respondWith(
			caches
				.open(ASSET_CACHE)
				.then(async (cache) => (await cache.match(request)) ?? fetch(request))
		);
	}
});
