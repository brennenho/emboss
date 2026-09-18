const worker = {
  fetch() {
    return new Response("Test runner");
  },
};
export default worker;
