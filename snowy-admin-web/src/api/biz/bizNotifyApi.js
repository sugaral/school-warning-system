import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/notify/' + url, ...arg)

export default {
	jobPage(data) {
		return request('job/page', data, 'get')
	},
	logPage(data) {
		return request('log/page', data, 'get')
	},
	enqueue(data) {
		return request('job/enqueue', data)
	},
	dispatchNow(data) {
		return request('job/dispatchNow', data)
	},
	cancelJob(data) {
		return request('job/cancel', data)
	},
	ackLog(data) {
		return request('log/ack', data)
	},
	deleteJobs(data) {
		return request('job/delete', data)
	}
}
