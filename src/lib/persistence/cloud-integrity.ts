import { canonicalJson } from './canonical';

/** SHA-256 lowercase hexadecimal digest for authored cloud content and operation inputs. */
export async function sha256Hex(value: string | Uint8Array | ArrayBuffer): Promise<string> {
	const bytes =
		typeof value === 'string'
			? new TextEncoder().encode(value)
			: value instanceof Uint8Array
				? value
				: new Uint8Array(value);
	const input = new Uint8Array(bytes.byteLength);
	input.set(bytes);
	const digest = await crypto.subtle.digest('SHA-256', input.buffer);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

/** Canonical SHA-256 digest for a strict JSON value. */
export function canonicalSha256(value: unknown): Promise<string> {
	return sha256Hex(canonicalJson(value));
}
