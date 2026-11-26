import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/leaverequest/' + url, ...arg)

export default {
	leaveRequestPage(data) {
		return request('page', data, 'get')
	},
	leaveRequestAdd(data) {
		return request('add', data)
	},
	leaveRequestApprove(data) {
		return request('approve', data)
	},
	leaveRequestDelete(data) {
		return request('delete', data)
	},
	leaveRequestDetail(data) {
		return request('detail', data, 'get')
	}
}
