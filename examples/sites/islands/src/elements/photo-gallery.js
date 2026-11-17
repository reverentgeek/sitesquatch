// <photo-gallery><ul><li><a href="full.png" data-caption="..."><img ...></a></li></ul></photo-gallery>:
// a lightbox over a list of linked photos. Without JavaScript, each photo links to the full image.
class PhotoGallery extends HTMLElement {
	connectedCallback() {
		this.links = [ ...this.querySelectorAll( "a[href]" ) ];
		if ( this.links.length === 0 ) return;
		this.dialog = document.createElement( "dialog" );
		this.dialog.className = "photo-gallery-box";
		this.dialog.innerHTML = `
			<figure><img alt=""><figcaption></figcaption></figure>
			<p class="photo-gallery-controls">
				<button type="button" data-step="-1" aria-label="Previous photo">&larr;</button>
				<span class="photo-gallery-count"></span>
				<button type="button" data-step="1" aria-label="Next photo">&rarr;</button>
				<button type="button" data-close aria-label="Close">&times;</button>
			</p>`;
		this.append( this.dialog );
		this.links.forEach( ( link, index ) => link.addEventListener( "click", ( event ) => {
			event.preventDefault();
			this.show( index );
			this.dialog.showModal();
		} ) );
		this.dialog.addEventListener( "click", ( event ) => {
			const button = event.target.closest( "button" );
			if ( button?.dataset.step ) this.show( this.index + Number( button.dataset.step ) );
			else if ( button?.hasAttribute( "data-close" ) || event.target === this.dialog ) this.dialog.close();
		} );
		// Escape closes a <dialog> by itself.
		this.dialog.addEventListener( "keydown", ( event ) => {
			if ( event.key === "ArrowLeft" ) this.show( this.index - 1 );
			if ( event.key === "ArrowRight" ) this.show( this.index + 1 );
		} );
	}

	show( index ) {
		const count = this.links.length;
		this.index = ( index + count ) % count;
		const link = this.links[this.index];
		const caption = link.dataset.caption ?? link.querySelector( "img" )?.alt ?? "";
		const img = this.dialog.querySelector( "img" );
		img.src = link.href;
		img.alt = caption;
		this.dialog.querySelector( "figcaption" ).textContent = caption;
		this.dialog.querySelector( ".photo-gallery-count" ).textContent = `${ this.index + 1 } of ${ count }`;
	}
}

customElements.define( "photo-gallery", PhotoGallery );
