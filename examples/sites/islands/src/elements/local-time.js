// <local-time datetime="2026-06-14T15:00:00Z">fallback</local-time>: the
// time in the visitor's own time zone.
class LocalTime extends HTMLElement {
	connectedCallback() {
		const date = new Date( this.getAttribute( "datetime" ) );
		if ( Number.isNaN( date.getTime() ) ) return;
		const time = document.createElement( "time" );
		time.dateTime = date.toISOString();
		time.textContent = date.toLocaleString( undefined, { dateStyle: "long", timeStyle: "short" } );
		this.replaceChildren( time );
	}
}

customElements.define( "local-time", LocalTime );
