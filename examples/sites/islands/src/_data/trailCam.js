// The trail camera's photos: every PNG in images/trail-cam/, with its size and the day it was
// taken (from the file name, 20260614_01.png), and a caption from the ranger's log.
import { files } from "ssqch";

const captions = {
	"20260614_01": "A tall figure near the Cedar trail. Probably a stump.",
	"20260614_02": "Pine cones, arranged in a pattern.",
	"20260615_01": "Something large resting by the creek.",
	"20260616_01": "The stump, which has moved."
};

export default files( "images/trail-cam/*.png", { dimensions: true } ).map( ( photo ) => ( {
	...photo,
	caption: captions[photo.stem] ?? photo.name
} ) );
