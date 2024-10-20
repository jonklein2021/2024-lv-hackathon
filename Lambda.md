# Lambda functions in case aws dies 
## Analyze Id - index.mjs
```
// index.mjs

import { RekognitionClient, DetectTextCommand } from "@aws-sdk/client-rekognition";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const rekognitionClient = new RekognitionClient();
const dynamoDBClient = new DynamoDBClient();
const s3Client = new S3Client();

export const handler = async (event) => {
  try {
    // Retrieve the image details from the S3 upload event
    const bucket = event.Records[0].s3.bucket.name;
    const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));

    const params = {
      Image: {
        S3Object: {
          Bucket: bucket,
          Name: key,
        },
      },
    };

    // Call Rekognition to detect text in the image
    const command = new DetectTextCommand(params);
    const result = await rekognitionClient.send(command);
    console.log('Rekognition result:', JSON.stringify(result, null, 2));

    // Keep the full TextDetection objects
    const detectedTextDetections = result.TextDetections;

    // Filter out detections with low confidence (e.g., less than 85%)
    const filteredDetections = detectedTextDetections.filter(detection => detection.Confidence >= 85);

    // Convert TextDetections to a more usable format, including position
    const textsWithPositions = filteredDetections.map(detection => ({
      text: detection.DetectedText,
      lowerText: detection.DetectedText.toLowerCase(),
      confidence: detection.Confidence,
      type: detection.Type, // LINE or WORD
      geometry: detection.Geometry,
    }));

    // Sort texts by their vertical position (Top)
    const sortedTexts = textsWithPositions.sort((a, b) => {
      return a.geometry.BoundingBox.Top - b.geometry.BoundingBox.Top;
    });

    console.log('Sorted Detected Texts:', sortedTexts.map(item => item.text));

    // Check if "Lehigh" is present
    const lehighIndex = sortedTexts.findIndex(item => item.lowerText.includes('lehigh'));

    if (lehighIndex === -1) {
      console.log('Invalid ID card: "Lehigh" not found.');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid ID card: "Lehigh" not detected.' }),
      };
    }

    // Start searching from the line after "Lehigh"
    const startIndex = lehighIndex + 1;

    // Initialize variables
    let studentName = 'Unknown Name';
    let studentID = 'Unknown ID';

    const excludeWords = ['lehigh', 'university', 'student', 'exp. date', 'exp.date', 'exp date', 'expire', 'expires', 'date'];

    // Extract the student name
    for (let i = startIndex; i < sortedTexts.length; i++) {
      const text = sortedTexts[i].text.trim();
      const lowerText = sortedTexts[i].lowerText.trim();

      // Skip excluded words
      if (excludeWords.includes(lowerText)) continue;

      // Check if the text matches the student name pattern
      if (/^[A-Z][a-zA-Z]*\s+([A-Z]\s+)?[A-Z][a-zA-Z]*$/.test(text)) {
        studentName = text;
        console.log('Student Name found:', studentName);
        break;
      }
    }

    // Extract the student ID (4-digit number without slashes)
    for (let i = startIndex; i < sortedTexts.length; i++) {
      const text = sortedTexts[i].text.trim();

      // Skip dates containing slashes
      if (text.includes('/')) continue;

      // Check for 4-digit number
      if (/^\d{4}$/.test(text)) {
        studentID = text;
        console.log('Student ID found:', studentID);
        break;
      }
    }

    // If student name or ID is still unknown, search the rest of the texts
    if (studentName === 'Unknown Name') {
      for (let i = 0; i < sortedTexts.length; i++) {
        if (i === lehighIndex) continue; // Skip "Lehigh"
        const text = sortedTexts[i].text.trim();
        const lowerText = sortedTexts[i].lowerText.trim();
        if (excludeWords.includes(lowerText)) continue;
        if (/^[A-Z][a-zA-Z]*\s+([A-Z]\s+)?[A-Z][a-zA-Z]*$/.test(text)) {
          studentName = text;
          console.log('Student Name found:', studentName);
          break;
        }
      }
    }

    if (studentID === 'Unknown ID') {
      for (let i = 0; i < sortedTexts.length; i++) {
        if (i === lehighIndex) continue; // Skip "Lehigh"
        const text = sortedTexts[i].text.trim();
        if (text.includes('/')) continue;
        if (/^\d{4}$/.test(text)) {
          studentID = text;
          console.log('Student ID found:', studentID);
          break;
        }
      }
    }

    // Check if both student name and ID were found
    if (studentName === 'Unknown Name' || studentID === 'Unknown ID') {
      console.log('Failed to extract student name or ID.');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Failed to extract student name or ID.' }),
      };
    }

    // Generate the pre-signed URL
    const getObjectParams = {
      Bucket: bucket,
      Key: key,
    };

    const getObjectCommand = new GetObjectCommand(getObjectParams);
    const imageUrl = await getSignedUrl(s3Client, getObjectCommand, { expiresIn: 3600 }); // URL valid for 1 hour

    // Store the detected text result in DynamoDB
    console.log('Valid ID card detected with student name and ID:', studentName, studentID);

    const putItemParams = {
      TableName: 'IDCardInfo', // Replace with your DynamoDB table name
      Item: {
        'StudentID': { S: studentID },
        'StudentName': { S: studentName },
        'DetectedTexts': { S: sortedTexts.map(item => item.text).join(' ') },
        'Timestamp': { N: Date.now().toString() },
        'ImageUrl': { S: imageUrl }, // Store the pre-signed URL
      },
    };

    const putItemCommand = new PutItemCommand(putItemParams);
    await dynamoDBClient.send(putItemCommand);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Data saved to DynamoDB', studentName, studentID, imageUrl }),
    };
  } catch (error) {
    console.error('Error analyzing image:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to analyze image' }),
    };
  }
};
```

## Result Retrieve - index.jms
```
// resultRetrieval.mjs

import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";

const dynamoDBClient = new DynamoDBClient();

export const handler = async (event) => {
  try {
    // Scan the DynamoDB table to get all entries
    const scanParams = {
      TableName: 'IDCardInfo', // Replace with your DynamoDB table name
    };

    const command = new ScanCommand(scanParams);
    const result = await dynamoDBClient.send(command);

    // Check if entries are found
    if (!result.Items || result.Items.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: 'No ID entries found.' }),
      };
    }

    // Map and sort the items based on Timestamp
    const items = result.Items.map((item) => ({
      studentName: item.StudentName.S,
      studentID: item.StudentID.S,
      imageUrl: item.ImageUrl.S,
      detectedTexts: item.DetectedTexts.S,
      timestamp: parseInt(item.Timestamp.N, 10),
    }));

    // Sort items by timestamp in descending order (most recent first)
    items.sort((a, b) => b.timestamp - a.timestamp);

    // Get the most recent entry
    const mostRecentItem = items[0];

    // Get the current time (in milliseconds)
    const currentTime = Date.now();

    // Define a threshold (e.g., 5 seconds)
    const timeThreshold = 5000; // 5000 milliseconds = 5 seconds

    // Check if the time difference is within the threshold
    if (currentTime - mostRecentItem.timestamp <= timeThreshold) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Valid ID',
          studentName: mostRecentItem.studentName,
          studentID: mostRecentItem.studentID,
          imageUrl: mostRecentItem.imageUrl,
          detectedTexts: mostRecentItem.detectedTexts,
        }),
      };
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'No valid ID detected recently.' }),
      };
    }
  } catch (error) {
    console.error('Error retrieving validation result:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to retrieve validation result' }),
    };
  }
};
```