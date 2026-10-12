// This file is deliberately NOT a module: it declares nothing and exports
// nothing. It is where the `require` condition of this package's export map
// sends TypeScript, and a `.d.cts` that is not a module makes the consumer's
// own import statement fail to compile. That is the point -- being ESM only is
// a position, and a position a consumer discovers from their build is a
// supported boundary, while one they discover from a crash is a trap.
//
// It declares nothing on purpose. A declaration in a script file is a global,
// and a global declared by more than one installed package collides.
//
// esm-only.cjs is the runtime half of the same guard.
