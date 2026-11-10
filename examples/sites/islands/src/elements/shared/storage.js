// Shared by the elements that remember things. It has no hyphen in its name,
// so it isn't an element itself: it's just a module the others import.
export function read( key, fallback ) {
	try {
		return JSON.parse( localStorage.getItem( key ) ) ?? fallback;
	} catch {
		return fallback;
	}
}

export function write( key, value ) {
	try {
		localStorage.setItem( key, JSON.stringify( value ) );
	} catch {
		// Private browsing: it just won't be remembered.
	}
}
