<script lang="ts">
	import { onMount } from 'svelte';
	import {
		APPEARANCE_STORAGE_KEY,
		applyAppearance,
		normalizeAppearance,
		type AppearancePreference
	} from './appearance';

	const CHANGE_EVENT = 'octometa:appearance-change';

	/** Apply the persisted preference and keep System synchronized with the OS. */
	onMount(() => {
		const root = document.documentElement;
		const media = window.matchMedia('(prefers-color-scheme: dark)');

		const render = (preference?: AppearancePreference): void => {
			const next =
				preference ?? normalizeAppearance(localStorage.getItem(APPEARANCE_STORAGE_KEY));
			root.classList.add('appearance-changing');
			applyAppearance(root, next, media.matches);
			requestAnimationFrame(() => root.classList.remove('appearance-changing'));
		};
		const onSystemChange = (): void => {
			if (root.dataset.appearancePreference === 'system') render('system');
		};
		const onPreferenceChange = (event: Event): void => {
			render((event as CustomEvent<AppearancePreference>).detail);
		};
		const onStorage = (event: StorageEvent): void => {
			if (event.key === APPEARANCE_STORAGE_KEY) render();
		};

		render();
		media.addEventListener('change', onSystemChange);
		window.addEventListener(CHANGE_EVENT, onPreferenceChange);
		window.addEventListener('storage', onStorage);
		return () => {
			media.removeEventListener('change', onSystemChange);
			window.removeEventListener(CHANGE_EVENT, onPreferenceChange);
			window.removeEventListener('storage', onStorage);
		};
	});
</script>
