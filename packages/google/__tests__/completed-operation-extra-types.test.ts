import { expectTypeOf, it } from "vitest";
import { EditMode } from "@google/genai";
import type {
  GoogleGeminiImageExtra,
  GoogleImageExtra,
  GoogleImagenEditExtra,
  GoogleImagenImageExtra,
} from "../src";

it("discriminates Google image endpoint extras", () => {
  const imagen = {
    imagen: { outputMimeType: "image/webp" },
  } satisfies GoogleImageExtra;
  const gemini = {
    gemini: { temperature: 0.2 },
  } satisfies GoogleImageExtra;
  const edit = {
    edit: {
      editMode: EditMode.EDIT_MODE_INPAINT_INSERTION,
      negativePrompt: "motorboat",
    },
  } satisfies GoogleImageExtra;
  expectTypeOf(imagen.imagen).toMatchTypeOf<GoogleImagenImageExtra>();
  expectTypeOf(gemini.gemini).toMatchTypeOf<GoogleGeminiImageExtra>();
  expectTypeOf(edit.edit).toMatchTypeOf<GoogleImagenEditExtra>();

  // @ts-expect-error Imagen native fields must be nested under `imagen`.
  const flatImagen: GoogleImageExtra = { outputMimeType: "image/png" };
  // @ts-expect-error Gemini generation fields are not Imagen endpoint controls.
  const wrongImagen: GoogleImagenImageExtra = { temperature: 0.2 };
  // @ts-expect-error Imagen output fields are not Gemini endpoint controls.
  const wrongGemini: GoogleGeminiImageExtra = { outputMimeType: "image/png" };
  // @ts-expect-error Portable image count cannot be shadowed by native edit options.
  const shadowedCount: GoogleImagenEditExtra = { numberOfImages: 2 };
  // @ts-expect-error Portable aspect ratio cannot be shadowed by native edit options.
  const shadowedAspectRatio: GoogleImagenEditExtra = { aspectRatio: "16:9" };
  // @ts-expect-error Portable seed cannot be shadowed by native edit options.
  const shadowedSeed: GoogleImagenEditExtra = { seed: 7 };
  expectTypeOf(flatImagen).toMatchTypeOf<GoogleImageExtra>();
  expectTypeOf(wrongImagen).toMatchTypeOf<GoogleImagenImageExtra>();
  expectTypeOf(wrongGemini).toMatchTypeOf<GoogleGeminiImageExtra>();
  expectTypeOf(shadowedCount).toMatchTypeOf<GoogleImagenEditExtra>();
  expectTypeOf(shadowedAspectRatio).toMatchTypeOf<GoogleImagenEditExtra>();
  expectTypeOf(shadowedSeed).toMatchTypeOf<GoogleImagenEditExtra>();
});
