const { SendEmailCommand } = require('@aws-sdk/client-ses');
const { CONTACT_FROM_EMAIL } = require('./email-config');
const { sesClient } = require('./aws-clients');
const { saveReview, listReviews, updateReviewStatus } = require('./review-store');

const ses = sesClient;

const submitReview = async ({ slug, authorName, rating, body, contactEmail, source }) => {
  if (!slug) {
    const error = new Error('slug is required');
    error.statusCode = 400;
    throw error;
  }
  if (!body) {
    const error = new Error('Review body is required');
    error.statusCode = 400;
    throw error;
  }
  const record = await saveReview({
    slug,
    authorName: authorName || 'Anonymous',
    rating: typeof rating === 'number' ? rating : null,
    body,
    source,
    contact: contactEmail || null,
    status: contactEmail ? 'pending' : 'approved',
  });
  if (contactEmail) {
    await ses
      .send(
        new SendEmailCommand({
          Source: CONTACT_FROM_EMAIL,
          Destination: { ToAddresses: [contactEmail] },
          Message: {
            Subject: { Data: 'Thanks for sharing your feedback!', Charset: 'UTF-8' },
            Body: {
              Text: {
                Data: 'Thanks for leaving a review. We will be in touch if we have any follow-up questions.',
                Charset: 'UTF-8',
              },
            },
          },
        })
      )
      .catch((err) => console.warn('[reviews] failed to send acknowledgment', err.message));
  }
  return record;
};

const listApprovedReviews = async ({ slug, limit }) => listReviews({ slug, status: 'approved', limit });

const setReviewStatus = async ({ slug, reviewId, status }) => {
  if (!slug || !reviewId || !status) {
    const error = new Error('slug, reviewId, and status are required');
    error.statusCode = 400;
    throw error;
  }
  await updateReviewStatus({ slug, reviewId, status });
  return { slug, reviewId, status };
};

module.exports = {
  submitReview,
  listApprovedReviews,
  setReviewStatus,
};
