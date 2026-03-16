const axios = require('axios');

const testData = {
  description: 'Create a simple calculator app with basic arithmetic operations',
  language: 'Node.js'
};

console.log('Testing API with data:', JSON.stringify(testData, null, 2));

axios.post('http://localhost:5000/api/ai/generate', testData)
  .then(response => {
    console.log('Success:', response.data);
  })
  .catch(error => {
    console.log('Error:', error.response?.data || error.message);
    if (error.response?.data?.rawResponse) {
      console.log('Raw AI Response (first 1000 chars):', error.response.data.rawResponse.substring(0, 1000));
    }
  });
