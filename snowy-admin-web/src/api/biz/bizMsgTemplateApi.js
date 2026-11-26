import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/msgtemplate/' + url, ...arg)

export default {
	templatePage(data) {
		return request('page', data, 'get')
	},
	submitForm(data, edit = false) {
		return request(edit ? 'edit' : 'add', data)
	},
	templateDelete(data) {
		return request('delete', data)
	},
	templateDetail(data) {
		return request('detail', data, 'get')
	},
	templateTestSend(data) {
		return request('testSend', data)
	}
}
