import { expectTypeOf, it } from "vitest";
import type {
  GoogleGeminiImageExtra,
  GoogleImageExtra,
  GoogleImagenImageExtra,
} from "../src";

it("discriminates Google image endpoint extras", () => {
  const imagen = {
    imagen: { outputMimeType: "image/webp" },
  } satisfies GoogleImageExtra;
  const gemini = {
    gemini: { temperature: 0.2 },
  } satisfies GoogleImageExtra;
  expectTypeOf(imagen.imagen).toMatchTypeOf<GoogleImagenImageExtra>();
  expectTypeOf(gemini.gemini).toMatchTypeOf<GoogleGeminiImageExtra>();

  // @ts-expect-error Imagen native fields must be nested under `imagen`.
  const flatImagen: GoogleImageExtra = { outputMimeType: "image/png" };
  // @ts-expect-error Gemini generation fields are not Imagen endpoint controls.
  const wrongImagen: GoogleImagenImageExtra = { temperature: 0.2 };
  // @ts-expect-error Imagen output fields are not Gemini endpoint controls.
  const wrongGemini: GoogleGeminiImageExtra = { outputMimeType: "image/png" };
  expectTypeOf(flatImagen).toMatchTypeOf<GoogleImageExtra>();
  expectTypeOf(wrongImagen).toMatchTypeOf<GoogleImagenImageExtra>();
  expectTypeOf(wrongGemini).toMatchTypeOf<GoogleGeminiImageExtra>();
});
