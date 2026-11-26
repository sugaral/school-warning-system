import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/classnotice/' + url, ...arg)

export default {
	noticePage(data) {
		return request('page', data, 'get')
	},
	submitForm(data, edit = false) {
		return request(edit ? 'edit' : 'add', data)
	},
	noticeDelete(data) {
		return request('delete', data)
	},
	noticeDetail(data) {
		return request('detail', data, 'get')
	},
	noticeReadStats(data) {
		return request('readStats', data, 'get')
	}
}
