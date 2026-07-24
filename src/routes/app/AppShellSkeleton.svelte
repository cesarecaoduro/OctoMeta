<script lang="ts">
	let { documentRoute = false }: { documentRoute?: boolean } = $props();
</script>

<main
	class:document-route={documentRoute}
	class="session-skeleton"
	data-testid="session-skeleton"
	data-shell={documentRoute ? 'workbench' : 'documents'}
	role="status"
	aria-label="Checking session"
	aria-busy="true"
>
	{#if documentRoute}
		<div class="workbench-bar">
			<span class="mark title"></span>
			<span class="mark control"></span>
			<span class="mark control"></span>
		</div>
		<div class="document">
			<span class="mark line long"></span>
			<span class="mark line medium"></span>
			<span class="mark line short"></span>
			<span class="mark line long"></span>
		</div>
		<div class="workbook">
			<span class="mark workbook-title"></span>
			<div class="workbook-grid"></div>
		</div>
	{:else}
		<div class="documents-heading">
			<span class="mark title"></span>
			<span class="mark button"></span>
		</div>
		<span class="mark search"></span>
		<div class="document-list">
			<span class="mark card"></span>
			<span class="mark card"></span>
			<span class="mark card"></span>
		</div>
	{/if}
</main>

<style>
	.session-skeleton {
		box-sizing: border-box;
		width: min(1180px, 100%);
		min-height: calc(100dvh - 58px);
		margin: 0 auto;
		padding: clamp(var(--s3), 5vw, var(--s5)) var(--s2);
		background: var(--surface);
	}
	.session-skeleton.document-route {
		width: 100%;
		min-height: 100dvh;
		padding: 0;
		background: var(--grey-4);
	}
	.mark {
		display: block;
		border-radius: var(--radius-chip);
		background: linear-gradient(90deg, var(--grey-3) 25%, var(--grey-4) 50%, var(--grey-3) 75%);
		background-size: 200% 100%;
		animation: shell-shimmer 1.4s ease-in-out infinite;
	}
	.documents-heading,
	.workbench-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s2);
	}
	.title { width: 190px; height: 30px; }
	.button { width: 132px; height: 44px; }
	.search { width: 100%; height: 44px; margin-top: var(--s4); }
	.document-list {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--s2);
		margin-top: var(--s3);
	}
	.card { height: 140px; border-radius: var(--radius-panel); }
	.workbench-bar {
		height: 58px;
		padding: 0 var(--s2);
		border-bottom: 1px solid var(--grey-3);
		background: var(--surface);
	}
	.workbench-bar .title { width: 150px; height: 18px; margin-right: auto; }
	.control { width: 44px; height: 32px; }
	.document {
		display: grid;
		gap: var(--s3);
		width: min(760px, calc(100% - var(--s4)));
		margin: var(--s5) auto;
		padding: var(--s4);
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-panel);
		background: var(--surface);
	}
	.line { height: 18px; }
	.line.long { width: 88%; }
	.line.medium { width: 68%; }
	.line.short { width: 44%; }
	.workbook {
		position: fixed;
		right: 0;
		bottom: 0;
		left: 0;
		height: min(38dvh, 360px);
		border-top: 1px solid var(--grey-3);
		background: var(--surface);
	}
	.workbook-title { width: 120px; height: 16px; margin: 14px var(--s2); }
	.workbook-grid {
		height: calc(100% - 44px);
		border-top: 1px solid var(--grey-3);
		background:
			repeating-linear-gradient(90deg, transparent 0 159px, var(--grey-3) 159px 160px),
			repeating-linear-gradient(180deg, transparent 0 43px, var(--grey-3) 43px 44px),
			var(--surface);
	}
	@keyframes shell-shimmer {
		from { background-position: 200% 0; }
		to { background-position: -200% 0; }
	}
	@media (max-width: 720px) {
		.document-list { grid-template-columns: 1fr; }
		.card { height: 104px; }
		.document { margin-block: var(--s3); padding: var(--s3); }
	}
	@media (prefers-reduced-motion: reduce) {
		.mark { animation: none; }
	}
</style>
