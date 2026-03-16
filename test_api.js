const axios = require('axios');

async function testGenerate(description, language = 'Node.js') {
  try {
    console.log(`Testing generation for: ${description}`);
    const response = await axios.post('http://localhost:5000/api/ai/generate', {
      description,
      language
    });
    console.log('Success:', response.data.message);
    console.log('Project Folder:', response.data.projectFolder);
    console.log('Download URL:', response.data.downloadURL);
    console.log('Executable URL:', response.data.executableURL);
    console.log('---');
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    console.log('---');
  }
}

async function runTests() {
  // Test small project
  await testGenerate('a simple todo app');

  // Test large projects
  await testGenerate('a full-featured Zomato-like food delivery app with user authentication, restaurant management, order tracking, payment integration, and admin dashboard');

  await testGenerate('a comprehensive Learning Management System (LMS) with course creation, student enrollment, video streaming, quizzes, progress tracking, and instructor analytics');

  await testGenerate('an e-commerce platform like Amazon with product catalog, shopping cart, user reviews, payment processing, order management, and seller dashboard');
}

runTests();
