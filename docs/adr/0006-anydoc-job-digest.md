# ADR 0006: Canonical Anydoc job digest

The worker capability identifies the complete job, not only its source bytes.

`requestDigest` is lowercase hexadecimal SHA-256 over these bytes in exactly
this order:

1. UTF-8 bytes of `crux-anydoc-job-digest-v1`, followed by one zero byte.
2. `version` as unsigned 32-bit big-endian.
3. For `nonce`, `format`, and lowercase hexadecimal `sourceSha256`, in that
   order: byte length as unsigned 32-bit big-endian, followed by UTF-8 bytes.
4. `sourceBytes`, `limits.sourceBytes`, and `limits.resultBytes`, in that
   order, each as unsigned 64-bit big-endian.

The source hash remains separately present to verify the staged file. Including
it, the source size, every limit, the format, and the nonce in the job digest
prevents a capability for one job from authorizing another. Go and the Node
runner compute and verify this encoding independently before accepting a
request or acknowledging a result.

The fixed compatibility vector is:

```text
version=1
nonce=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
format=docx
sourceSha256=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
sourceBytes=3
limits.sourceBytes=1024
limits.resultBytes=2048
digest=4e4347a464cdcead83d42ecbfbbe90a15bc0c95cfeb01b5b9158b2c5af2220c2
```
