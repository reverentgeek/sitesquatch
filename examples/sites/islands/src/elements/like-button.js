// <like-button key="home">fallback</like-button>: a button that counts.
import { read, write } from "./shared/storage.js";

class LikeButton extends HTMLElement {
	connectedCallback() {
		const key = `likes:${ this.getAttribute( "key" ) ?? location.pathname }`;
		let count = read( key, 0 );
		const button = document.createElement( "button" );
		button.type = "button";
		const show = () => {
			button.textContent = count === 1 ? "♥ 1 like" : `♥ ${ count } likes`;
		};
		button.addEventListener( "click", () => {
			count += 1;
			write( key, count );
			show();
		} );
		show();
		// The fallback link gives way to the button.
		this.replaceChildren( button );
	}
}

customElements.define( "like-button", LikeButton );
