declare module '*.png' {
  const src: string
  export default src
}

// Text files bundled as strings (CHANGELOG.md for What's New).
declare module '*?raw' {
  const text: string
  export default text
}
